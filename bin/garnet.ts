#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { GarnetStack } from '../lib/garnet-stack';
import { Parameters } from '../parameters';

const app = new App();

new GarnetStack(app, 'Garnet', {
    stackName: 'Garnet',
    env: { region: Parameters.aws_region }
})