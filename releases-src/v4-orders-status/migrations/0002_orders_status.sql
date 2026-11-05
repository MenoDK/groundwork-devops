-- The orders table gets a status. v4 reads it, so the release must not go live before this has run.
alter table orders add column if not exists status text not null default 'new';
create index if not exists orders_status_idx on orders (status);
