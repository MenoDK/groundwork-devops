.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose
PROM := prom/prometheus:v2.55.1
# The browser container runs as you, so what it writes (node_modules, screenshots) is yours to delete.
E2E_USER := --user $$(id -u):$$(id -g) -e HOME=/tmp

.PHONY: help env up down reset logs lint lint-sh test-api test-ops test-rules validate-iac check smoke e2e transcripts sabotage screenshots

help: ## list the targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'

env: ## write .env with a fresh random database password (never overwrites an existing one)
	@if [ -f .env ]; then echo ".env already exists, leaving it alone"; else \
	  echo "POSTGRES_PASSWORD=$$(openssl rand -hex 16)" > .env; echo "wrote .env with a fresh random database password"; fi

up: env ## build and start the server, the database and Prometheus (http://localhost:8100)
	$(COMPOSE) up --build --wait -d
	@scripts/first-release.sh http://localhost:$${GW_PORT:-8100}
	@echo; echo "  site + lab + API:  http://localhost:$${GW_PORT:-8100}   (press 'Enter the lab')"; echo "  stop with:         make down"

down: ## stop everything and keep the data
	$(COMPOSE) down

reset: ## stop and delete the releases, the backups and the database
	$(COMPOSE) down -v

logs: ## follow the logs
	$(COMPOSE) logs -f host

lint: ## biome and the TypeScript compiler (needs pnpm: corepack enable)
	pnpm install --frozen-lockfile
	pnpm exec biome check .
	pnpm exec tsc --noEmit

lint-sh: ## shellcheck on every script (a container; nothing to install)
	docker run --rm -v "$$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:v0.10.0 -x -P SCRIPTDIR -s bash scripts/*.sh ops/*.sh ops/stages/*.sh test/ops/helper.bash

test-api: ## the control API's tests (vitest)
	pnpm exec vitest run

test-ops: env ## the shell tests (bats) against a real nginx, real processes and a real PostgreSQL
	$(COMPOSE) --profile test run --rm --build ops-test

test-rules: ## the alert rules: promtool check + unit tests of when each one fires
	docker run --rm --entrypoint promtool -v "$$PWD/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro" -v "$$PWD/prometheus/rules.yml:/etc/prometheus/rules.yml:ro" $(PROM) check config /etc/prometheus/prometheus.yml
	docker run --rm --entrypoint promtool -v "$$PWD/prometheus:/p:ro" $(PROM) test rules /p/rules.test.yml

validate-iac: ## Terraform fmt + validate, Helm lint + template, kubeconform (containers; nothing is applied anywhere)
	docker run --rm --entrypoint sh -v "$$PWD/infra/terraform:/src:ro" hashicorp/terraform:1.9 -c 'cp -r /src /w && cd /w && terraform fmt -check -diff && terraform init -backend=false -input=false >/dev/null && terraform validate'
	docker run --rm -v "$$PWD/infra/helm:/c:ro" alpine/helm:3.16.3 lint /c/groundwork
	docker run --rm -v "$$PWD/infra/helm:/c:ro" alpine/helm:3.16.3 template groundwork /c/groundwork | docker run --rm -i ghcr.io/yannh/kubeconform:v0.6.7 -strict -summary -kubernetes-version 1.30.0 -

check: lint lint-sh test-api test-ops test-rules validate-iac ## everything the CI checks except the stack, the browser and the mutation run

smoke: ## 34 checks against the running stack, including an alert firing and clearing (make up first)
	scripts/smoke.sh http://localhost:$${GW_PORT:-8100}

e2e: env ## browser tests (Playwright + axe) against the running stack
	@mkdir -p docs/img  # Docker would create a missing bind-mount source as root, and then you could not write to docs/
	$(COMPOSE) up --build --wait -d
	$(COMPOSE) --profile e2e run --rm $(E2E_USER) e2e

transcripts: ## re-record the guided tour on the page from the running stack
	node scripts/record-transcripts.mjs

sabotage: env ## break each gate on purpose and confirm the test that guards it goes red
	scripts/sabotage.sh

screenshots: env ## re-take the README screenshots (docs/img) from the running stack
	@mkdir -p docs/img
	$(COMPOSE) up --build --wait -d
	$(COMPOSE) --profile e2e run --rm $(E2E_USER) -e SHOTS=1 e2e bash -lc "npm ci --no-audit --no-fund && npx playwright test shots"
