# Customer Login – Manual Verification

## Prerequisites

1. `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (from Supabase Dashboard > Settings > API > service_role)
2. Admin user has `role = 'admin'` in `profiles` table
3. At least one existing customer in `customers` table (for setup/reset)

## Scenarios to Test

### 1. Set up login (existing customer, no auth_user_id)

- Go to Customers → click a customer who has **No login**
- Enter password (min 8 chars) → click **Set up login**
- Expected: Success message, badge changes to **Login active**
- Verify: Customer can sign in at website with that email + password

### 2. Reset password (existing customer, has auth_user_id)

- Go to a customer with **Login active**
- Enter new password → click **Reset password**
- Expected: Success message
- Verify: Customer can sign in at website with new password

### 3. Create new customer account (customers list)

- Go to Customers → fill **Create new customer account** (name, email, password)
- Click **Create customer account**
- Expected: Success, new row appears in table
- Verify: Customer can sign in at website

### 4. Error cases

- **Customer not found**: Open a customer detail page, then delete that customer in Supabase. Try Set up login → expect clear error.
- **Duplicate email**: Create customer with an existing email → expect "A customer with this email already exists."
- **Weak password**: Enter < 8 chars → button disabled or validation error.
- **Already has login**: Try Set up login on customer with Login active → expect "Use Reset password instead."
