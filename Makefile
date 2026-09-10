# SPDX-License-Identifier: Apache-2.0 OR MIT
# POSIX-compatible Makefile. Works on macOS, Linux and WSL without modification.

.PHONY: all test unit e2e lint clean

all: lint test

test:
	npm test

unit:
	npm run test:unit

e2e:
	npm run test:e2e

lint:
	npm run lint

clean:
	rm -rf node_modules coverage *.tgz
