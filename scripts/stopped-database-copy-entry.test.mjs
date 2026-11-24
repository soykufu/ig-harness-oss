import test from 'node:test';import assert from 'node:assert/strict';import {copyExecutionAllowed} from './stopped-database-copy-entry.mjs';
const env={GITHUB_REPOSITORY:'soykufu/ig-harness-oss',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_NUMBER:'40',GITHUB_RUN_ATTEMPT:'1',DATABASE_COPY:'true'};
test('only the single designated first dispatch attempt can export',()=>assert.equal(copyExecutionAllowed(env),true));
for(const [k,v]of Object.entries({GITHUB_REPOSITORY:'other/fork',GITHUB_REF:'refs/heads/other',GITHUB_EVENT_NAME:'push',GITHUB_RUN_NUMBER:'41',GITHUB_RUN_ATTEMPT:'2',DATABASE_COPY:'false'}))test('export blocked for changed '+k,()=>assert.equal(copyExecutionAllowed({...env,[k]:v}),false));
