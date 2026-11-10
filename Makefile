.PHONY: check typecheck lint test build test-ui dev test-export
check: typecheck lint test test-render test-account check-brand build
test-account:
	npm run test:account
test-account-ui:
	npm run test:account-ui
test-export:
	node --test shared/color.test.ts shared/export.test.ts
test-storage:
	node --test shared/draft.test.ts shared/library.test.ts
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
	node scripts/check-build.mjs
test-ui:
	npm run test:browser
dev:
	npm run dev

check-brand:
	node scripts/import-brand.mjs
