CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id text NOT NULL,
    consent_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    user_agent text NOT NULL,
    app_version text NOT NULL,
    camera_facing text CHECK (camera_facing IN ('user', 'environment')),
    notes text
);


CREATE TABLE images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    round integer NOT NULL,
    frame_index integer NOT NULL,
    gesture text NOT NULL CHECK (gesture IN ('rock', 'paper', 'scissors','none')),
    landmarks jsonb NOT NULL,
    world_landmarks jsonb NOT NULL,
    crop_x real NOT NULL,
    crop_y real NOT NULL,
    crop_side real NOT NULL,
    frame_width integer NOT NULL,
    frame_height integer NOT NULL,
    brightness real NOT NULL CHECK (brightness >= 0 AND brightness <= 255),
    handedness text CHECK (handedness IN ('Left', 'Right')),
    handedness_score real CHECK (handedness_score >= 0 AND handedness_score <= 1),
    file_path text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, round, gesture, frame_index)
);