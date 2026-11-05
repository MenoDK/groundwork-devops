-- The data the backups protect: an orders table large enough that a restore means something.
create table if not exists orders (
  id         bigserial primary key,
  customer   text        not null,
  total_cents integer    not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);
insert into orders (customer, total_cents)
select 'customer-' || g, (g * 137) % 90000 from generate_series(1, 1000) as g;
