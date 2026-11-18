"use client";

/**
 * Unsubscribe this browser's push alerts before signing out so the next user on
 * this device does not receive notifications, returning the old endpoint for server cleanup.
 */
export async function unsubscribePushEndpoint(timeoutMs = 1500): Promise<string | null> {
  let endpoint: string | null = null;
  const cleanUp = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    endpoint = sub.endpoint;
    await sub.unsubscribe();
  };
  await Promise.race([cleanUp().catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))]);
  return endpoint;
}

/** Programmatically submit a POST sign-out so push cleanup and cookie deletion both run. */
export async function submitSignOut(reason?: "idle") {
  const endpoint = await unsubscribePushEndpoint();
  const form = document.createElement("form");
  form.method = "POST";
  form.action = reason ? `/auth/signout?reason=${encodeURIComponent(reason)}` : "/auth/signout";
  form.style.display = "none";
  if (endpoint) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "endpoint";
    input.value = endpoint;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
