# WEB010: production smoke testing with rootless Podman.
# Override variables when needed, e.g. make serve PORT=18081.
CONTAINER_ENGINE ?= podman
IMAGE ?= localhost/protos-website:web010
CONTAINER_NAME ?= protos-website-web010
BIND_ADDR ?= 127.0.0.1
PORT ?= 18080
READY_ATTEMPTS ?= 30

.PHONY: help build image serve smoke stop logs status test check

help:
	@printf '%s\n' \
	  'make serve        Build/start NGINX and wait for HTTP readiness (Podman)' \
	  'make smoke        Verify HTTP, live catalog SHA and D064 provenance' \
	  'make stop         Stop and remove the local production container' \
	  'make logs         Follow the production container logs' \
	  'make status       Show the local container, including exited states' \
	  'make build        Build the production container image' \
	  'make test         Prepare grammar and run Node.js tests' \
	  'make check        Run tests, source/release checks and git diff --check'

build: image

image:
	$(CONTAINER_ENGINE) build --target production -t $(IMAGE) .

serve: image
	@$(CONTAINER_ENGINE) rm -f $(CONTAINER_NAME) >/dev/null 2>&1 || true
	$(CONTAINER_ENGINE) run -d \
	  --name $(CONTAINER_NAME) \
	  -p $(BIND_ADDR):$(PORT):8080 \
	  $(IMAGE)
	@ready=0; attempt=0; \
	  while [ "$$attempt" -lt "$(READY_ATTEMPTS)" ]; do \
	    attempt=$$((attempt + 1)); \
	    if curl --fail --silent --max-time 3 -o /dev/null \
	      'http://$(BIND_ADDR):$(PORT)/'; then \
	      ready=1; break; \
	    fi; \
	    if ! $(CONTAINER_ENGINE) inspect --format '{{.State.Running}}' \
	      $(CONTAINER_NAME) 2>/dev/null | grep -qx true; then \
	      break; \
	    fi; \
	    sleep 1; \
	  done; \
	  if [ "$$ready" -ne 1 ]; then \
	    printf 'WEB010_SERVE_READY=FAIL\n' >&2; \
	    $(CONTAINER_ENGINE) ps -a --filter name=$(CONTAINER_NAME) >&2; \
	    $(CONTAINER_ENGINE) logs --tail 100 $(CONTAINER_NAME) >&2 || true; \
	    exit 1; \
	  fi; \
	  printf 'WEB010_SERVE_READY=PASS attempts=%s\n' "$$attempt"; \
	  printf 'WEB010_SERVE=http://%s:%s/\n' '$(BIND_ADDR)' '$(PORT)'

smoke:
	@python3 scripts/smoke-production.py \
	  --base-url 'http://$(BIND_ADDR):$(PORT)' || { \
	  $(CONTAINER_ENGINE) ps -a --filter name=$(CONTAINER_NAME) >&2; \
	  $(CONTAINER_ENGINE) logs --tail 100 $(CONTAINER_NAME) >&2 || true; \
	  exit 1; \
	}

stop:
	@$(CONTAINER_ENGINE) rm -f $(CONTAINER_NAME) >/dev/null 2>&1 || true
	@printf 'WEB010_STOPPED=%s\n' '$(CONTAINER_NAME)'

logs:
	$(CONTAINER_ENGINE) logs -f $(CONTAINER_NAME)

status:
	$(CONTAINER_ENGINE) ps -a --filter name=$(CONTAINER_NAME)

test:
	npm run prepare:protos
	node --test tests/*.test.mjs

check: test
	npm run check
	git diff --check
