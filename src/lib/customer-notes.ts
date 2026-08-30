import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type CustomerNoteRow = {
  id: string;
  customer_id: string;
  customer_property_id: string | null;
  body: string;
  is_customer_visible: boolean;
  author_email: string | null;
  created_at: string | null;
};

const NOTES_COLUMNS_WITH_PROPERTY =
  "id, customer_id, customer_property_id, body, is_customer_visible, author_email, created_at";
const NOTES_COLUMNS_BASE =
  "id, customer_id, body, is_customer_visible, author_email, created_at";

function isMissingPropertyColumnError(message: string | undefined): boolean {
  return !!message && /customer_property_id|schema cache/i.test(message);
}

export async function loadCustomerNotesForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{
  notes: CustomerNoteRow[];
  propertyScopeSupported: boolean;
  error: PostgrestError | null;
}> {
  const withProperty = await supabase
    .from("customer_notes")
    .select(NOTES_COLUMNS_WITH_PROPERTY)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (isMissingPropertyColumnError(withProperty.error?.message)) {
    const fallback = await supabase
      .from("customer_notes")
      .select(NOTES_COLUMNS_BASE)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    const notes = ((fallback.data ?? []) as Omit<CustomerNoteRow, "customer_property_id">[]).map(
      (row) => ({ ...row, customer_property_id: null }),
    );
    return {
      notes,
      propertyScopeSupported: false,
      error: fallback.error,
    };
  }

  return {
    notes: (withProperty.data ?? []) as unknown as CustomerNoteRow[],
    propertyScopeSupported: true,
    error: withProperty.error,
  };
}

export async function insertCustomerNote(
  supabase: SupabaseClient,
  input: {
    customerId: string;
    customerPropertyId: string | null;
    body: string;
    isCustomerVisible: boolean;
    authorEmail: string | null;
    propertyScopeSupported?: boolean;
  },
): Promise<{
  data: CustomerNoteRow | null;
  propertyScopeSupported: boolean;
  error: PostgrestError | null;
}> {
  const usePropertyColumn = input.propertyScopeSupported !== false;

  if (input.customerPropertyId && !usePropertyColumn) {
    return {
      data: null,
      propertyScopeSupported: false,
      error: {
        message:
          "Property-scoped notes are not available until the customer_notes migration is applied on this database.",
        details: "",
        hint: "",
        code: "PGRST204",
      } as PostgrestError,
    };
  }

  const basePayload = {
    customer_id: input.customerId,
    body: input.body.trim(),
    is_customer_visible: input.isCustomerVisible,
    author_email: input.authorEmail,
  };

  if (usePropertyColumn) {
    const withProperty = await supabase
      .from("customer_notes")
      .insert({
        ...basePayload,
        customer_property_id: input.customerPropertyId,
      })
      .select(NOTES_COLUMNS_WITH_PROPERTY)
      .single();

    if (isMissingPropertyColumnError(withProperty.error?.message)) {
      if (input.customerPropertyId) {
        return {
          data: null,
          propertyScopeSupported: false,
          error: withProperty.error,
        };
      }
      const fallback = await supabase
        .from("customer_notes")
        .insert(basePayload)
        .select(NOTES_COLUMNS_BASE)
        .single();
      if (fallback.error || !fallback.data) {
        return {
          data: null,
          propertyScopeSupported: false,
          error: fallback.error,
        };
      }
      return {
        data: {
          ...(fallback.data as Omit<CustomerNoteRow, "customer_property_id">),
          customer_property_id: null,
        },
        propertyScopeSupported: false,
        error: null,
      };
    }

    return {
      data: (withProperty.data as unknown as CustomerNoteRow) ?? null,
      propertyScopeSupported: true,
      error: withProperty.error,
    };
  }

  const fallback = await supabase
    .from("customer_notes")
    .insert(basePayload)
    .select(NOTES_COLUMNS_BASE)
    .single();

  return {
    data: fallback.data
      ? {
          ...(fallback.data as Omit<CustomerNoteRow, "customer_property_id">),
          customer_property_id: null,
        }
      : null,
    propertyScopeSupported: false,
    error: fallback.error,
  };
}
