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
