CREATE OR REPLACE FUNCTION public.allow_ai_request(
    p_user_id TEXT,
    p_window_seconds INTEGER,
    p_request_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $function$
DECLARE
    request_cutoff TIMESTAMPTZ;
    recent_request_count INTEGER;
BEGIN
    IF p_user_id IS NULL OR BTRIM(p_user_id) = '' THEN
        RAISE EXCEPTION 'User ID must not be empty';
    END IF;

    IF p_window_seconds <= 0 OR p_request_limit <= 0 THEN
        RAISE EXCEPTION 'Rate limit settings must be positive';
    END IF;

    -- Serialize requests for this user across API instances.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(p_user_id, 0)
    );

    -- Calculate the rolling window after acquiring the lock.
    request_cutoff :=
        clock_timestamp() - (p_window_seconds * INTERVAL '1 second');

    SELECT COUNT(*)::INTEGER
    INTO recent_request_count
    FROM public.ai_request_events
    WHERE user_id = p_user_id
      AND requested_at > request_cutoff;

    IF recent_request_count >= p_request_limit THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.ai_request_events (
        user_id,
        requested_at
    )
    VALUES (
        p_user_id,
        clock_timestamp()
    );

    RETURN TRUE;
END;
$function$;