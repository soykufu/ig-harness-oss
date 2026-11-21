import {recruitmentStepVersion,type StepVersion} from './recruitment-step-version.js';
import { evaluateCondition } from './step-delivery.js';
/** Read-only final admission for a claimed scheduled step. No enrollment,
 * progression, consent, window or owner evidence is created by this check. */
export async function assertRecruitmentStepReady(db: D1Database, accountId: string, followerId: number, key: string, expectedVersion?: string): Promise<void> {
  const match = /^step:([1-9][0-9]*):([1-9][0-9]*)$/.exec(key);
  if (!expectedVersion || !/^[a-f0-9]{64}$/.test(expectedVersion) || !match || match.slice(1).some(v=>!Number.isSafeInteger(Number(v)))) throw Error('Invalid recruitment step identity');
  const row = await db.prepare(`SELECT st.* FROM follower_scenarios fs
    JOIN followers f ON f.id=fs.follower_id AND f.account_id=?
    JOIN scenarios s ON s.id=fs.scenario_id AND s.account_id=f.account_id AND s.is_active=1
    JOIN scenario_steps st ON st.scenario_id=s.id AND st.id=?
    WHERE fs.id=? AND fs.follower_id=? AND fs.status='active'
      AND fs.end_reason='delivery_in_progress' AND fs.next_step_at IS NULL
      AND st.step_order>fs.current_step AND NOT EXISTS(SELECT 1 FROM scenario_steps earlier
        WHERE earlier.scenario_id=s.id AND earlier.step_order>fs.current_step AND earlier.step_order<st.step_order)`)
    .bind(accountId,Number(match[2]),Number(match[1]),followerId).first<StepVersion & {condition_type:string|null;condition_value:string|null}>();
  if (!row || await recruitmentStepVersion(row)!==expectedVersion || !await evaluateCondition(db,String(followerId),row,true)) throw Error('Recruitment step requires reconciliation');
}
