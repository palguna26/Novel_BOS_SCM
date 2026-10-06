# Authentication

The application supports sign-in only. It does not expose registration, password creation, or user-management screens.

## Create an operator

1. In Supabase Dashboard, create the user under **Authentication → Users** with an email and password.
2. Copy the Auth user UUID.
3. Add the matching application profile and company access using the Supabase SQL editor:

```sql
insert into iam.users (id, email, display_name, role)
values ('AUTH_USER_UUID', 'operator@example.com', 'Operator name', 'TEAM_MEMBER');

insert into iam.user_company_access (user_id, company_id, can_read, can_write, can_approve)
values ('AUTH_USER_UUID', 'COMPANY_UUID', true, true, false);
```

Use `ADMIN`, `MANAGER`, `QC`, or another allowed role when appropriate. The user must be active and have at least one company access row with `can_read = true`.

The web app calls `/auth/login` with email and password. Access tokens are refreshed through `/auth/refresh`; no Supabase service-role key is sent to the browser.
