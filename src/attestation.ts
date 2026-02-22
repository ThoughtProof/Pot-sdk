// Stub for JWT attestation
export async function createAttestation(result: any, options: { signingKey: string }) {
  const payload = {
    ...result,
    schema: 'pot-attestation-v1',
  };
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString('base64')}.mock`;
  return { token, verifiable: true, schema: 'pot-attestation-v1' };
}