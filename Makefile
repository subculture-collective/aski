.PHONY: check typecheck lint test build test-ui dev
check: typecheck lint test test-render build
test-storage:
	node --test shared/draft.test.ts
test-render:
	npm run test:render
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
