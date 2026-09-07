/**
 * Tests for the pipeline's configuration applier.
 *
 * This script rewrites configuration.ts before synth, so a silent failure here
 * means deploying the wrong architecture or strategy to a real environment. The
 * cases below cover the ways that can go wrong: an unknown value, a pattern that
 * no longer matches the file, and the unsupported distributed + blue/green pair.
 */

import * as fs from 'fs'
import * as path from 'path'

const { apply_configuration } = require('../.github/scripts/apply-configuration.js')

const REAL_CONFIG = fs.readFileSync(
  path.join(__dirname, '..', 'configuration.ts'),
  'utf8'
)

describe('apply_configuration', () => {
  it('keeps Scorpio as the explicit default engine', () => {
    const { source, engine } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated'
    })

    expect(engine).toBe('Scorpio')
    expect(source).toContain('broker_engine: BROKER_ENGINE.Scorpio')
  })

  it('selects Garnet only with a digest-pinned distributed image', () => {
    const image = `public.ecr.aws/garnet/broker@sha256:${'a'.repeat(64)}`
    const load_image =
      `public.ecr.aws/garnet/load@sha256:${'b'.repeat(64)}`
    const { source, engine } = apply_configuration(REAL_CONFIG, {
      GARNET_BROKER_ENGINE: 'garnet',
      GARNET_BROKER_IMAGE: image,
      GARNET_LOAD_IMAGE: load_image,
      GARNET_ARCHITECTURE: 'distributed'
    })

    expect(engine).toBe('Garnet')
    expect(source).toContain('broker_engine: BROKER_ENGINE.Garnet')
    expect(source).toContain(`garnet_broker_image: "${image}"`)
    expect(source).toContain(`garnet_load_image: "${load_image}"`)
  })

  it('sets the concentrated architecture', () => {
    const { source, architecture } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated'
    })

    expect(architecture).toBe('Concentrated')
    expect(source).toContain('architecture: ARCHITECTURE.Concentrated')
    expect(source).not.toContain('architecture: ARCHITECTURE.Distributed')
  })

  it('sets the distributed architecture', () => {
    const { source } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'distributed'
    })

    expect(source).toContain('architecture: ARCHITECTURE.Distributed')
  })

  it('keeps eventual Entity reads explicit', () => {
    const disabled = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated'
    })
    const enabled = apply_configuration(REAL_CONFIG, {
      GARNET_BROKER_ENGINE: 'garnet',
      GARNET_BROKER_IMAGE:
        `public.ecr.aws/garnet/broker@sha256:${'a'.repeat(64)}`,
      GARNET_ARCHITECTURE: 'distributed',
      GARNET_EVENTUAL_ENTITY_READS: 'true'
    })

    expect(disabled.eventual_reads).toBe(false)
    expect(disabled.source)
      .toContain('garnet_eventual_entity_reads: false')
    expect(enabled.eventual_reads).toBe(true)
    expect(enabled.source)
      .toContain('garnet_eventual_entity_reads: true')
  })

  it('defaults to the rolling strategy when none is given', () => {
    const { strategy, source } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated'
    })

    expect(strategy).toBe('Rolling')
    expect(source).toContain('deployment_strategy: DEPLOYMENT_STRATEGY.Rolling')
  })

  it('sets the blue/green strategy for the concentrated architecture', () => {
    const { source } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated',
      GARNET_DEPLOYMENT_STRATEGY: 'bluegreen'
    })

    expect(source).toContain('deployment_strategy: DEPLOYMENT_STRATEGY.BlueGreen')
  })

  it('accepts values in any case', () => {
    const { architecture, strategy } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'Distributed',
      GARNET_DEPLOYMENT_STRATEGY: 'ROLLING'
    })

    expect(architecture).toBe('Distributed')
    expect(strategy).toBe('Rolling')
  })

  it('sets the region when provided', () => {
    const { source } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated',
      GARNET_REGION: 'eu-west-1'
    })

    expect(source).toContain('aws_region: "eu-west-1"')
  })

  it('leaves the region untouched when not provided', () => {
    const { source } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'concentrated'
    })

    expect(source).toContain('aws_region: "us-east-1"')
  })

  describe('rejects bad input rather than deploying a default', () => {
    it('fails on an unknown architecture', () => {
      expect(() => apply_configuration(REAL_CONFIG, { GARNET_ARCHITECTURE: 'monolith' }))
        .toThrow(/GARNET_ARCHITECTURE must be one of/)
    })

    it('fails on an unknown broker engine', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_BROKER_ENGINE: 'other',
        GARNET_ARCHITECTURE: 'distributed'
      })).toThrow(/GARNET_BROKER_ENGINE must be one of/)
    })

    it('requires Garnet to use the distributed rolling profile', () => {
      const image = `public.ecr.aws/garnet/broker@sha256:${'a'.repeat(64)}`
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_BROKER_ENGINE: 'garnet',
        GARNET_BROKER_IMAGE: image,
        GARNET_ARCHITECTURE: 'concentrated'
      })).toThrow(/requires GARNET_ARCHITECTURE=distributed/)
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_BROKER_ENGINE: 'garnet',
        GARNET_BROKER_IMAGE: image,
        GARNET_ARCHITECTURE: 'distributed',
        GARNET_DEPLOYMENT_STRATEGY: 'bluegreen'
      })).toThrow(/not supported with the distributed architecture/)
    })

    it('requires a digest-pinned Garnet image', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_BROKER_ENGINE: 'garnet',
        GARNET_BROKER_IMAGE: 'public.ecr.aws/garnet/broker:latest',
        GARNET_ARCHITECTURE: 'distributed'
      })).toThrow(/must be a digest-pinned image/)
    })

    it('accepts only a digest-pinned Garnet load image', () => {
      const image =
        `public.ecr.aws/garnet/broker@sha256:${'a'.repeat(64)}`
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_BROKER_ENGINE: 'garnet',
        GARNET_BROKER_IMAGE: image,
        GARNET_LOAD_IMAGE: 'public.ecr.aws/garnet/load:latest',
        GARNET_ARCHITECTURE: 'distributed'
      })).toThrow(/GARNET_LOAD_IMAGE must be a digest-pinned image/)
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_LOAD_IMAGE:
          `public.ecr.aws/garnet/load@sha256:${'b'.repeat(64)}`,
        GARNET_ARCHITECTURE: 'concentrated'
      })).toThrow(/available only with GARNET_BROKER_ENGINE=garnet/)
    })

    it('fails on a missing architecture', () => {
      expect(() => apply_configuration(REAL_CONFIG, {}))
        .toThrow(/GARNET_ARCHITECTURE must be one of/)
    })

    it('fails on an unknown strategy', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_ARCHITECTURE: 'concentrated',
        GARNET_DEPLOYMENT_STRATEGY: 'canary'
      })).toThrow(/GARNET_DEPLOYMENT_STRATEGY must be one of/)
    })

    it('fails on a malformed region', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_ARCHITECTURE: 'concentrated',
        GARNET_REGION: 'not-a-region!'
      })).toThrow(/does not look like an AWS region/)
    })

    it('rejects an invalid Entity-read consistency switch', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_ARCHITECTURE: 'concentrated',
        GARNET_EVENTUAL_ENTITY_READS: 'sometimes'
      })).toThrow(/GARNET_EVENTUAL_ENTITY_READS/)
    })

    it('does not silently apply Garnet reader settings to Scorpio', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_ARCHITECTURE: 'concentrated',
        GARNET_EVENTUAL_ENTITY_READS: 'true'
      })).toThrow(/available only with GARNET_BROKER_ENGINE=garnet/)
    })

    it('rejects blue/green with the distributed architecture', () => {
      expect(() => apply_configuration(REAL_CONFIG, {
        GARNET_ARCHITECTURE: 'distributed',
        GARNET_DEPLOYMENT_STRATEGY: 'bluegreen'
      })).toThrow(/not supported with the distributed architecture/)
    })

    it('fails loudly if configuration.ts no longer has the expected setting', () => {
      const renamed = REAL_CONFIG.replace(/architecture: ARCHITECTURE\.\w+/, 'arch: ARCHITECTURE.Concentrated')

      expect(() => apply_configuration(renamed, { GARNET_ARCHITECTURE: 'concentrated' }))
        .toThrow(/Could not find the architecture setting/)
    })
  })

  it('produces a file that still parses as TypeScript', () => {
    const { source } = apply_configuration(REAL_CONFIG, {
      GARNET_ARCHITECTURE: 'distributed',
      GARNET_DEPLOYMENT_STRATEGY: 'rolling',
      GARNET_REGION: 'ap-southeast-2'
    })

    const ts = require('typescript')
    const result = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true
    })

    expect(result.diagnostics ?? []).toHaveLength(0)
  })
})
