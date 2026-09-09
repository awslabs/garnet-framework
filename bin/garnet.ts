#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import {
    GarnetFrameworkStack
} from '../lib/garnet-framework-stack';
import { Parameters } from '../configuration';
import { garnet_stack_name } from '../constants';

const app = new App();

new GarnetFrameworkStack(app, garnet_stack_name, {
    stackName: garnet_stack_name,
    description: 'Garnet Framework is an open-source framework for building scalable, reliable and interoperable solutions and platforms - (uksb-1tupboc26)',
    env: { region: Parameters.aws_region }
})
