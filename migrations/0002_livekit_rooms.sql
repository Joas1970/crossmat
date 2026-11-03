create table if not exists crossmat_live_rooms (
  id text primary key,
  livekit_room text not null unique,
  host_secret_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);

create index if not exists crossmat_live_rooms_expiry_idx
  on crossmat_live_rooms (expires_at);

create table if not exists crossmat_live_guests (
  id text primary key,
  room_id text not null references crossmat_live_rooms(id) on delete cascade,
  display_name text not null,
  request_secret_hash text not null,
  status text not null check (status in ('pending', 'approved', 'denied', 'removed', 'left')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz
);

create index if not exists crossmat_live_guests_room_status_idx
  on crossmat_live_guests (room_id, status, created_at);
