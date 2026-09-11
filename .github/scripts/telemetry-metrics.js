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

const TELEMETRY_METRICS = [
  {
    role: 'ingress-request-count',
    queryId: 'ingress_requests'
  },
  {
    role: 'ingress-p99-seconds',
    queryId: 'ingress_p99'
  },
  {
    role: 'ingress-5xx-count',
    queryId: 'ingress_5xx'
  },
  {
    role: 'compute-cpu-maximum-percent',
    queryId: 'compute_cpu'
  },
  {
    role: 'compute-memory-maximum-percent',
    queryId: 'compute_memory'
  },
  {
    role: 'database-cpu-maximum-percent',
    queryId: 'database_cpu'
  },
  {
    role: 'database-connections-maximum',
    queryId: 'database_connections'
  }
]

const REQUIRED_METRIC_IDS = TELEMETRY_METRICS.map(
  metric => metric.queryId
)

const non_empty_string = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} shall be a non-empty string`)
  }
  return value
}

const dimensions = values =>
  Object.entries(values).map(([Name, Value]) => ({
    Name,
    Value: non_empty_string(Value, `metric dimension ${Name}`)
  }))

const metric_query = (
  Id,
  Namespace,
  MetricName,
  Dimensions,
  Stat,
  ReturnData = true
) => ({
  Id,
  MetricStat: {
    Metric: {
      Namespace,
      MetricName,
      Dimensions: dimensions(Dimensions)
    },
    Period: 60,
    Stat
  },
  ReturnData
})

const expression_query = (Id, Expression) => ({
  Id,
  Expression,
  Period: 60,
  ReturnData: true
})

const filled_metric = (
  queries,
  Id,
  Namespace,
  MetricName,
  Dimensions,
  Stat
) => {
  const raw = `${Id}_raw`
  queries.push(
    metric_query(
      raw,
      Namespace,
      MetricName,
      Dimensions,
      Stat,
      false
    ),
    expression_query(Id, `FILL(${raw}, 0)`)
  )
}

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

const maximum_expression = ids => `MAX([${ids.join(',')}])`

const metric_data_queries = (telemetry, cluster) => {
  const api_dimensions = {
    ApiId: telemetry.api_id,
    Stage: telemetry.api_stage
  }
  const queries = [
    metric_query(
      'ingress_requests',
      'AWS/ApiGateway',
      'Count',
      api_dimensions,
      'Sum'
    ),
    metric_query(
      'ingress_p99_ms',
      'AWS/ApiGateway',
      'Latency',
      api_dimensions,
      'p99',
      false
    ),
    expression_query('ingress_p99', 'ingress_p99_ms / 1000'),
    metric_query(
      'ingress_5xx_raw',
      'AWS/ApiGateway',
      '5xx',
      api_dimensions,
      'Sum',
      false
    ),
    expression_query('ingress_5xx', 'FILL(ingress_5xx_raw, 0)'),
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

  const cpu_ids = []
  const memory_ids = []
  for (const service of BROKER_SERVICES) {
    const id = service_metric_id(service)
    const cpu_id = `ecs_${id}_cpu`
    const memory_id = `ecs_${id}_memory`
    cpu_ids.push(cpu_id)
    memory_ids.push(memory_id)
    queries.push(
      metric_query(
        cpu_id,
        'AWS/ECS',
        'CPUUtilization',
        {
          ClusterName: telemetry.broker_cluster,
          ServiceName: service
        },
        'Maximum'
      ),
      metric_query(
        memory_id,
        'AWS/ECS',
        'MemoryUtilization',
        {
          ClusterName: telemetry.broker_cluster,
          ServiceName: service
        },
        'Maximum'
      )
    )
  }
  queries.push(
    expression_query('compute_cpu', maximum_expression(cpu_ids)),
    expression_query('compute_memory', maximum_expression(memory_ids)),
    metric_query(
      'delivery_utilization',
      'Garnet/Broker',
      'WorkerUtilizationMax',
      { Service: 'garnet-delivery' },
      'Maximum'
    ),
    metric_query(
      'snapshot_utilization',
      'Garnet/Broker',
      'WorkerUtilizationMax',
      { Service: 'garnet-snapshot' },
      'Maximum'
    )
  )

  for (const [id, metric, stat] of [
    ['sqs_visible', 'ApproximateNumberOfMessagesVisible', 'Maximum'],
    ['sqs_age', 'ApproximateAgeOfOldestMessage', 'Maximum'],
    ['sqs_sent', 'NumberOfMessagesSent', 'Sum'],
    ['sqs_received', 'NumberOfMessagesReceived', 'Sum'],
    ['sqs_deleted', 'NumberOfMessagesDeleted', 'Sum']
  ]) {
    filled_metric(
      queries,
      id,
      'AWS/SQS',
      metric,
      { QueueName: telemetry.event_queue },
      stat
    )
  }

  for (const [id, metric, stat] of [
    [
      'firehose_freshness',
      'DeliveryToIceberg.DataFreshness',
      'Maximum'
    ],
    [
      'firehose_failed_rows',
      'DeliveryToIceberg.FailedRowCount',
      'Sum'
    ],
    ['firehose_throttled', 'ThrottledRecords', 'Sum'],
    ['firehose_partition_exceeded', 'PartitionCountExceeded', 'Sum'],
    [
      'firehose_successful_rows',
      'DeliveryToIceberg.SuccessfulRowCount',
      'Sum'
    ],
    ['firehose_partitions', 'PartitionCount', 'Maximum']
  ]) {
    filled_metric(
      queries,
      id,
      'AWS/Firehose',
      metric,
      { DeliveryStreamName: telemetry.lake_stream },
      stat
    )
  }

  queries.push(
    metric_query(
      'rds_cluster_capacity',
      'AWS/RDS',
      'ServerlessDatabaseCapacity',
      { DBClusterIdentifier: telemetry.database_cluster },
      'Average'
    )
  )

  const database_cpu_ids = []
  const database_connection_ids = []
  let reader_index = 0
  for (const member of database_members(cluster)) {
    const role = member.writer
      ? 'writer'
      : `reader_${reader_index++}`
    const member_dimensions = {
      DBInstanceIdentifier: member.identifier
    }
    for (const [suffix, metric, stat] of [
      ['cpu', 'CPUUtilization', 'Maximum'],
      ['connections', 'DatabaseConnections', 'Maximum'],
      ['acu', 'ACUUtilization', 'Maximum'],
      ['capacity', 'ServerlessDatabaseCapacity', 'Maximum'],
      ['commit_latency', 'CommitLatency', 'Maximum'],
      ['commit_throughput', 'CommitThroughput', 'Sum'],
      ['read_iops', 'ReadIOPS', 'Maximum'],
      ['write_iops', 'WriteIOPS', 'Maximum'],
      ['read_latency', 'ReadLatency', 'Maximum'],
      ['write_latency', 'WriteLatency', 'Maximum'],
      ['replica_lag', 'AuroraReplicaLag', 'Maximum']
    ]) {
      const id = `rds_${role}_${suffix}`
      queries.push(metric_query(
        id,
        'AWS/RDS',
        metric,
        member_dimensions,
        stat
      ))
      if (suffix === 'cpu') database_cpu_ids.push(id)
      if (suffix === 'connections') database_connection_ids.push(id)
    }
  }
  queries.push(
    expression_query(
      'database_cpu',
      maximum_expression(database_cpu_ids)
    ),
    expression_query(
      'database_connections',
      maximum_expression(database_connection_ids)
    )
  )
  return queries
}

const expected_timestamps = window => {
  const start = Date.parse(window?.started_at)
  const end = Date.parse(window?.completed_at)
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start % 60_000 !== 0 ||
    end % 60_000 !== 0 ||
    end <= start ||
    (end - start) % 60_000 !== 0
  ) {
    throw new Error(
      'telemetry window shall contain aligned whole-minute periods'
    )
  }
  return Array.from(
    { length: (end - start) / 60_000 },
    (_, index) => new Date(start + index * 60_000).toISOString()
  )
}

const metric_data_reasons = (response, window, queries) => {
  const reasons = []
  if (Array.isArray(response?.Messages) && response.Messages.length > 0) {
    reasons.push('CloudWatch returned collection messages')
  }
  const results = response?.MetricDataResults
  if (!Array.isArray(results)) {
    return [...reasons, 'CloudWatch returned no MetricDataResults']
  }
  if (!Array.isArray(queries) || queries.length === 0) {
    return [...reasons, 'telemetry metric queries are missing']
  }
  const query_ids = []
  for (const query of queries) {
    if (
      query === null ||
      typeof query !== 'object' ||
      typeof query.Id !== 'string' ||
      query.Id === '' ||
      typeof query.ReturnData !== 'boolean'
    ) {
      reasons.push('telemetry metric query identity is invalid')
      continue
    }
    query_ids.push(query.Id)
    const has_metric = (
      query.MetricStat !== null &&
      typeof query.MetricStat === 'object'
    )
    const has_expression = (
      typeof query.Expression === 'string' &&
      query.Expression !== ''
    )
    if (has_metric === has_expression) {
      reasons.push(`${query.Id} shall define one metric or expression`)
      continue
    }
    const period = has_metric
      ? query.MetricStat.Period
      : query.Period
    if (period !== 60) {
      reasons.push(`${query.Id} does not use the 60-second period`)
    }
  }
  if (new Set(query_ids).size !== query_ids.length) {
    reasons.push('telemetry metric queries repeat ids')
  }
  const returned_ids = queries
    .filter(
      query =>
        query?.ReturnData === true &&
        typeof query.Id === 'string'
    )
    .map(query => query.Id)
  const returned = new Set(returned_ids)
  for (const id of REQUIRED_METRIC_IDS) {
    if (!returned.has(id)) {
      reasons.push(`${id} is not returned by the telemetry query`)
    }
  }
  const expected = window === undefined
    ? undefined
    : expected_timestamps(window)
  const by_id = new Map()
  for (const result of results) {
    if (
      typeof result?.Id !== 'string' ||
      by_id.has(result.Id) ||
      !returned.has(result.Id)
    ) {
      reasons.push('CloudWatch returned an unknown or duplicate metric id')
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
      result.Values.some(
        value => !Number.isFinite(value) || value < 0
      )
    ) {
      reasons.push(`${result.Id} has inconsistent timestamps and values`)
      continue
    }
    if (
      ['ingress_requests', 'ingress_5xx'].includes(result.Id) &&
      result.Values.some(value => !Number.isSafeInteger(value))
    ) {
      reasons.push(`${result.Id} does not contain integer counts`)
    }
    if (
      [
        'compute_cpu',
        'compute_memory',
        'database_cpu'
      ].includes(result.Id) &&
      result.Values.some(value => value > 100)
    ) {
      reasons.push(`${result.Id} exceeds 100 percent`)
    }
    if (
      expected !== undefined &&
      (
        result.Timestamps.length !== expected.length ||
        result.Timestamps.some(
          (value, index) =>
            new Date(value).toISOString() !== expected[index]
        )
      )
    ) {
      reasons.push(`${result.Id} does not cover every telemetry period`)
    }
  }
  for (const id of returned_ids) {
    if (!by_id.has(id)) reasons.push(`${id} has no valid datapoints`)
  }
  if (by_id.size !== returned.size) {
    reasons.push('CloudWatch results do not match returned telemetry queries')
  }
  return reasons
}

const metric_sum = (response, id) => {
  const result = response.MetricDataResults
    .find(candidate => candidate.Id === id)
  if (result === undefined || !Array.isArray(result.Values)) {
    throw new Error(`CloudWatch result ${id} is missing`)
  }
  return result.Values.reduce((sum, value) => sum + value, 0)
}

module.exports = {
  BROKER_SERVICES,
  REQUIRED_METRIC_IDS,
  TELEMETRY_METRICS,
  database_members,
  expected_timestamps,
  metric_data_queries,
  metric_data_reasons,
  metric_sum
}
