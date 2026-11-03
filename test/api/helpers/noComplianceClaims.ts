// Asserts an API response body makes no compliance verdict: the serialized JSON must not
// contain "met", "COMPLIANT", "compliant" or "compliance_status" anywhere (plain substring
// match, so it also covers keys, values and NON_COMPLIANT).
export const FORBIDDEN = ["met", "COMPLIANT", "compliant", "compliance_status"];

export function expectNoComplianceClaims(body: unknown): void {
  const json = JSON.stringify(body ?? null);
  for (const word of FORBIDDEN) {
    if (json.includes(word)) {
      throw new Error(`API response contains forbidden "${word}": ${json}`);
    }
  }
}
