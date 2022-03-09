#!/bin/bash

set -eux

rm -rf package package.tar
mkdir package
pip install -t package python-runner
cd package
tar cfv ../package.tar *
