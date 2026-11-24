// Metadata only. This module never reads credentials, makes a request, or
// registers an account. Presence is not proof of validity or permission.
export const STOPPED_ACCOUNT_SPEC = Object.freeze({
  igUserId: '17841402028638204', username: 'soykufu',
  connectionType: 'facebook_login', pageId: '1632563283635095',
  subscribeWebhooks: false,
});
const credentialNames = ['TOKEN_ENCRYPTION_KEY', 'IG_APP_SECRET', 'IG_VERIFY_TOKEN'];
const environmentAccountNames = ['IG_ACCESS_TOKEN', 'IG_USER_ID'];

export function inspectConnectionCredentialMetadata(bindings) {
  if (!Array.isArray(bindings)) return { verified: false };
  const rows = name => bindings.filter(row => row?.name === name);
  const validSecret = name => rows(name).length === 1 && rows(name)[0].type === 'secret_text';
  // Secret text must remain opaque. Unexpected duplicates/types mean hold,
  // even when another row with the same name looks valid.
  const verified = credentialNames.every(name => rows(name).length === 0 || validSecret(name))
    && environmentAccountNames.every(name => rows(name).length <= 1)
    && rows('IG_APP_ID').length <= 1;
  return {
    verified,
    tokenEncryptionKeyPresent: validSecret('TOKEN_ENCRYPTION_KEY'),
    appSecretPresent: validSecret('IG_APP_SECRET'),
    verifyTokenPresent: validSecret('IG_VERIFY_TOKEN'),
    appIdConfigured: rows('IG_APP_ID').length === 1 && rows('IG_APP_ID')[0].type === 'plain_text'
      && rows('IG_APP_ID')[0].text === '2224712165014101',
    environmentAccountAbsent: environmentAccountNames.every(name => rows(name).length === 0),
  };
}

/** Separate stopped registration planning from webhook activation. */
export function assessStoppedConnectionReadiness(snapshot) {
  const blockers = [];
  const c = snapshot?.connectionCredentialMetadata;
  if (snapshot?.stopped !== true) blockers.push('outbound_stop_unverified');
  if (snapshot?.preparationLockVerified !== true) blockers.push('preparation_lock_unverified');
  if (snapshot?.extraFlagsVerified !== true) blockers.push('optional_flags_unverified');
  if (snapshot?.connectedAccounts !== 0 || snapshot?.followers !== 0) blockers.push('installation_not_empty');
  const inventory = snapshot?.migrationInventory;
  if (snapshot?.schemaReady !== true || !inventory || inventory.expected !== 41
    || inventory.applied !== 41 || inventory.matching !== 41
    || !['missing','modified','unexpected','duplicates'].every(k => Array.isArray(inventory[k]) && inventory[k].length === 0))
    blockers.push('schema_unverified');
  if (snapshot?.deploymentStable !== true || snapshot?.deployedBindingsVerified !== true
    || snapshot?.deploymentFingerprint !== '693814e3519ac1d1521ab0fb40288043d18952cf32cbee232d784fa5f72ac145')
    blockers.push('runtime_requires_reconciliation');
  if (c?.verified !== true) blockers.push('credential_metadata_unverified');
  if (c?.tokenEncryptionKeyPresent !== true) blockers.push('token_encryption_key_unverified');
  if (c?.environmentAccountAbsent !== true) blockers.push('environment_account_requires_reconciliation');
  const receivingPrerequisites = [];
  if (c?.appSecretPresent !== true) receivingPrerequisites.push('app_secret_not_observed');
  if (c?.verifyTokenPresent !== true) receivingPrerequisites.push('verify_token_not_observed');
  if (c?.appIdConfigured !== true) receivingPrerequisites.push('expected_app_id_not_observed');
  return {
    state: blockers.length ? 'held' : 'stopped_registration_review_ready',
    blockers, receivingPrerequisites,
    registrationSpec: { ...STOPPED_ACCOUNT_SPEC },
    registrationAuthorized: false, webhookActivationAuthorized: false, messagesAuthorized: false,
    metaIdentityRechecked: false, credentialValuesRead: false, registrationAttempted: false,
    subscriptionAttempted: false, messagesSent: 0,
  };
}
