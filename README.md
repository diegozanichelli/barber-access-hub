# Caixa Roots Tree

I want to build a SaaS for Cash Register Auditing for a Barbershop chain. We will build this in stages to ensure high quality. This is STAGE 1: Authentication, Roles, and Routing.

Please set up a Supabase project with Authentication and a PostgreSQL database.

1. Database Setup:

Create a units table (id, name - e.g., Parque10, Ponta Negra).

Create a profiles table linked to Supabase Auth users. It needs: id, full_name, role, and unit_id (foreign key to units, except for Admins).

2. User Roles: We have 4 strictly defined roles:

Attendant (Atendente)

Supervisor

Partner (Sócio - Very explicit login needed for this role)

Auditor/Admin (Auditor)

3. UI & Routing (Mobile-first design):

Build a clean Login Screen.

After login, route the user to their specific dashboard based on their role:

Attendant Dashboard: Show "Welcome [Name] - Unit [Unit Name]". Leave space for future shift buttons.

Supervisor Dashboard: Show "Welcome Supervisor [Name]".

Partner Dashboard (Sócio): Show "Welcome Partner [Name]". Leave space for future "Pending Approvals".

Auditor Dashboard: Show "Welcome Admin".

Do not build the cash register features yet. Focus ONLY on a robust authentication system, assigning roles correctly in Supabase, and routing users to the correct blank dashboards.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d6f9a349-2b1d-4b19-8905-272d787e72b9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
