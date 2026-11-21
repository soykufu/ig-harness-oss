import { describe, expect, it, vi } from 'vitest';
import { forwardLinkedInstagramEngagement } from './line-mileage.js';

function fakeDb(lineFriendUuid: string | null) {
  const connections = [
    { id: 'default', worker_url: 'https://line-a.example.com/', api_key: 'key-a', is_default: 1 },
    { id: 'other', worker_url: 'https://line-b.example.com', api_key: 'key-b', is_default: 0 },
  ];
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() { return sql.includes('FROM followers') ? { line_friend_uuid: lineFriendUuid } : null; },
        async all() { return { results: connections }; },
      };
    },
  } as unknown as D1Database;
}

describe('forwardLinkedInstagramEngagement', () => {
  it('does nothing until IG and LINE identities are linked', async () => {
    const fetchImpl = vi.fn();
    expect(await forwardLinkedInstagramEngagement(fakeDb(null), {
      followerId: 1, eventType: 'instagram_dm_received', sourceEventId: 'mid-1',
    }, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('tries registered Harness connections until the linked UUID is found', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await forwardLinkedInstagramEngagement(fakeDb('line-friend-1'), {
      followerId: 7,
      eventType: 'instagram_comment_created',
      sourceEventId: 'comment-1',
      subjectKey: 'media-1',
      metadata: { accountId: 'ig-account-1' },
    }, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://line-b.example.com/api/integrations/ig-harness/engagement',
    );
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string)).toMatchObject({
      friendId: 'line-friend-1',
      eventType: 'instagram_comment_created',
      sourceEventId: 'comment-1',
    });
  });

  it('accepts the instagram_story_replied event type (U7 story_reply種別)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await forwardLinkedInstagramEngagement(fakeDb('line-friend-2'), {
      followerId: 3,
      eventType: 'instagram_story_replied',
      sourceEventId: 'a:story:mid-9',
      subjectKey: 'story-9',
      metadata: { storyUrl: 'https://example.com/s/9' },
    }, fetchImpl)).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body as string)).toMatchObject({
      eventType: 'instagram_story_replied',
      sourceEventId: 'a:story:mid-9',
      subjectKey: 'story-9',
    });
  });
});

it.each(['instagram_dm_received','instagram_comment_created','instagram_story_mentioned','instagram_story_replied','instagram_referral_received','instagram_message_reacted'] as const)('holds unverified recruitment LINE handoff for %s before reading connection credentials',async eventType=>{const db={prepare:vi.fn(()=>{throw Error('No identity or connection read is allowed');})} as unknown as D1Database;const fetch=vi.fn();expect(await forwardLinkedInstagramEngagement(db,{followerId:1,accountId:'a',recruitmentEnforced:true,eventType,sourceEventId:'source'},fetch)).toBe(false);expect(db.prepare).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
it.each([401,403,429,500,502,503])('does not try another connection after HTTP %s',async status=>{const fetch=vi.fn().mockResolvedValue(new Response(status===403?'error code: 1010':'{}',{status}));expect(await forwardLinkedInstagramEngagement(fakeDb('linked'),{followerId:1,eventType:'instagram_dm_received',sourceEventId:'same'},fetch)).toBe(false);expect(fetch).toHaveBeenCalledOnce();});
it('does not reroute an unknown transport outcome to another connection',async()=>{const fetch=vi.fn().mockRejectedValue(Error('Unknown transport outcome'));expect(await forwardLinkedInstagramEngagement(fakeDb('linked'),{followerId:1,eventType:'instagram_dm_received',sourceEventId:'same'},fetch)).toBe(false);expect(fetch).toHaveBeenCalledOnce();});
it('scopes a known server account while resolving legacy linked recipients',async()=>{const bind=vi.fn().mockReturnValue({first:async()=>null});const db={prepare:vi.fn().mockReturnValue({bind})} as unknown as D1Database;const fetch=vi.fn();await forwardLinkedInstagramEngagement(db,{followerId:7,accountId:'a',eventType:'instagram_dm_received',sourceEventId:'same'},fetch);expect(bind).toHaveBeenCalledWith(7,'a','a');expect(fetch).not.toHaveBeenCalled();});
