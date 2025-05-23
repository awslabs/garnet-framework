#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { GarnetStack } from '../lib/garnet-stack';
import { Parameters } from '../configuration';

const app = new App();

new GarnetStack(app, 'Garnet', {
    stackName: 'Garnet',
    description: 'Garnet Framework is an open-source framework for building scalable, reliable and interoperable solutions and platforms - (uksb-1tupboc26)',
    env: { region: Parameters.aws_region }
})