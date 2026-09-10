const BROKER_SERVICES = [
  'garnet-api',
  'garnet-federation',
  'garnet-relay',
  'garnet-matcher',
  'garnet-lake-sink',
  'garnet-delivery',
  'garnet-notification-scheduler',
  'garnet-subscription-reconciler',
  'garnet-snapshot'
]

const REQUIRED_METRIC_IDS = [
  'app_requests',
  'app_5xx',
  'app_rejected',
  'app_p99',
  'ecs_api_cpu',
  'ecs_api_memory',
  'rds_writer_cpu',
  'rds_writer_connections',
  'rds_writer_acu',
  'rds_cluster_capacity'
]

const non_empty_string = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} shall be a non-empty string`)
  }
  return value
}

const dimensions = values =>
  Object.entries(values).map(([Name, Value]) => ({ Name, Value }))

const metric_query = (
  Id,
  Namespace,
  MetricName,
  Dimensions,
  Stat,
  Period = 60
) => ({
  Id,
  MetricStat: {
    Metric: {
      Namespace,
      MetricName,
      Dimensions: dimensions(Dimensions)
    },
    Period,
    Stat
  },
  ReturnData: true
})

const service_metric_id = service =>
  service.replace(/^garnet-/, '').replaceAll('-', '_')

const database_members = cluster => {
  const members = cluster?.DBClusterMembers
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('Aurora cluster has no DBClusterMembers')
  }
  const normalized = members.map(member => ({
    identifier: non_empty_string(
      member?.DBInstanceIdentifier,
      'DBClusterMember.DBInstanceIdentifier'
    ),
    writer: member?.IsClusterWriter === true
  }))
  if (normalized.filter(member => member.writer).length !== 1) {
    throw new Error('Aurora cluster shall have exactly one writer')
  }
  return [
    normalized.find(member => member.writer),
    ...normalized
      .filter(member => !member.writer)
      .sort((left, right) =>
        left.identifier.localeCompare(right.identifier)
      )
  ]
}

const metric_data_queries = (telemetry, cluster) => {
  const queries = [
    metric_query(
      'app_requests',
      'Garnet/Broker',
      'Requests',
      { Service: 'garnet-api' },
      'Sum'
    ),
    metric_query(
      'app_5xx',
      'Garnet/Broker',
      'Responses5xx',
      { Service: 'garnet-api' },
      'Sum'
    ),
    metric_query(
      'app_rejected',
      'Garnet/Broker',
      'Rejected',
      { Service: 'garnet-api' },
      'Sum'
    ),
    metric_query(
      'app_p99',
      'Garnet/Broker',
      'DurationP99Ms',
      { Service: 'garnet-api' },
      'Maximum'
    )
  ]

  for (const service of BROKER_SERVICES) {
    const id = service_metric_id(service)
    queries.push(
      metric_query(
        `ecs_${id}_cpu`,
        'AWS/ECS',
        'CPUUtilization',
        {
          ClusterName: telemetry.broker_cluster,
          ServiceName: service
        },
        'Average'
      ),
      metric_query(
        `ecs_${id}_memory`,
        'AWS/ECS',
        'MemoryUtilization',
        {
          ClusterName: telemetry.broker_cluster,
          ServiceName: service
        },
        'Average'
      )
    )
  }

  queries.push(
    metric_query(
      'sqs_visible',
      'AWS/SQS',
      'ApproximateNumberOfMessagesVisible',
      { QueueName: telemetry.event_queue },
      'Maximum'
    ),
    metric_query(
      'sqs_age',
      'AWS/SQS',
      'ApproximateAgeOfOldestMessage',
      { QueueName: telemetry.event_queue },
      'Maximum'
    ),
    metric_query(
      'sqs_sent',
      'AWS/SQS',
      'NumberOfMessagesSent',
      { QueueName: telemetry.event_queue },
      'Sum'
    ),
    metric_query(
      'sqs_received',
      'AWS/SQS',
      'NumberOfMessagesReceived',
      { QueueName: telemetry.event_queue },
      'Sum'
    ),
    metric_query(
      'sqs_deleted',
      'AWS/SQS',
      'NumberOfMessagesDeleted',
      { QueueName: telemetry.event_queue },
      'Sum'
    ),
    metric_query(
      'rds_cluster_capacity',
      'AWS/RDS',
      'ServerlessDatabaseCapacity',
      { DBClusterIdentifier: telemetry.database_cluster },
      'Average'
    ),
    metric_query(
      'rds_volume_read_iops',
      'AWS/RDS',
      'VolumeReadIOPs',
      { DBClusterIdentifier: telemetry.database_cluster },
      'Average',
      300
    ),
    metric_query(
      'rds_volume_write_iops',
      'AWS/RDS',
      'VolumeWriteIOPs',
      { DBClusterIdentifier: telemetry.database_cluster },
      'Average',
      300
    )
  )

  let reader_index = 0
  for (const member of database_members(cluster)) {
    const role = member.writer
      ? 'writer'
      : `reader_${reader_index++}`
    const member_dimensions = {
      DBInstanceIdentifier: member.identifier
    }
    for (const [suffix, metric, stat] of [
      ['cpu', 'CPUUtilization', 'Average'],
      ['connections', 'DatabaseConnections', 'Maximum'],
      ['acu', 'ACUUtilization', 'Average'],
      ['capacity', 'ServerlessDatabaseCapacity', 'Average'],
      ['commit_latency', 'CommitLatency', 'Average'],
      ['commit_throughput', 'CommitThroughput', 'Sum'],
      ['read_latency', 'ReadLatency', 'Average'],
      ['write_latency', 'WriteLatency', 'Average'],
      ['replica_lag', 'AuroraReplicaLag', 'Maximum']
    ]) {
      queries.push(metric_query(
        `rds_${role}_${suffix}`,
        'AWS/RDS',
        metric,
        member_dimensions,
        stat
      ))
    }
  }
  return queries
}

const metric_data_reasons = (response, window) => {
  const reasons = []
  if (Array.isArray(response?.Messages) && response.Messages.length > 0) {
    reasons.push('CloudWatch returned collection messages')
  }
  const results = response?.MetricDataResults
  if (!Array.isArray(results)) {
    return [...reasons, 'CloudWatch returned no MetricDataResults']
  }
  const by_id = new Map()
  for (const result of results) {
    if (typeof result?.Id !== 'string' || by_id.has(result.Id)) {
      reasons.push('CloudWatch returned a missing or duplicate metric id')
      continue
    }
    by_id.set(result.Id, result)
    if (result.StatusCode !== 'Complete') {
      reasons.push(`${result.Id} status is ${result.StatusCode ?? 'missing'}`)
    }
    if (
      !Array.isArray(result.Timestamps) ||
      !Array.isArray(result.Values) ||
      result.Timestamps.length !== result.Values.length ||
      result.Timestamps.some(
        value => !Number.isFinite(Date.parse(value))
      ) ||
      result.Values.some(value => !Number.isFinite(value))
    ) {
      reasons.push(`${result.Id} has inconsistent timestamps and values`)
    }
  }
  for (const id of REQUIRED_METRIC_IDS) {
    const result = by_id.get(id)
    if (
      result === undefined ||
      !Array.isArray(result.Timestamps) ||
      !Array.isArray(result.Values) ||
      result.Values.length === 0 ||
      result.Timestamps.length !== result.Values.length ||
      result.Timestamps.some(
        value => !Number.isFinite(Date.parse(value))
      ) ||
      result.Values.some(value => !Number.isFinite(value))
    ) {
      reasons.push(`${id} has no valid datapoints`)
      continue
    }
    if (window !== undefined) {
      const timestamps = result.Timestamps.map(value => Date.parse(value))
      const earliest = Math.min(...timestamps)
      const latest = Math.max(...timestamps)
      if (earliest > Date.parse(window.started_at) + 120_000) {
        reasons.push(`${id} does not cover the start of the load run`)
      }
      if (latest < Date.parse(window.completed_at) - 120_000) {
        reasons.push(`${id} does not cover the end of the load run`)
      }
    }
  }
  return reasons
}

const metric_sum = (response, id) => {
  const result = response.MetricDataResults
    .find(candidate => candidate.Id === id)
  return result.Values.reduce((sum, value) => sum + value, 0)
}

module.exports = {
  BROKER_SERVICES,
  REQUIRED_METRIC_IDS,
  database_members,
  metric_data_queries,
  metric_data_reasons,
  metric_sum
}
