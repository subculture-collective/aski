.PHONY: check typecheck lint test build test-ui dev
check: typecheck lint test build
typecheck:
	npm run typecheck
lint:
	npm run lint
test:
	npm test
build:
	npm run build
test-ui:
	npm run test:browser
dev:
	npm run dev
