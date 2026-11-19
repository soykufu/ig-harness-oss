-- Apply before connecting Meta credentials or enabling any outbound traffic.
-- This initializes the stop switch; it does not implement the shared rolling
-- 60-minute limit or all-path delivery window. Keep paused until those checks pass.
INSERT INTO integration_settings(key,value)
VALUES ('outbound_paused','1'),
       ('delivery_window_start_jst','8'),
       ('delivery_window_end_jst','21')
ON CONFLICT(key) DO UPDATE SET
 value=excluded.value,
 updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now');
