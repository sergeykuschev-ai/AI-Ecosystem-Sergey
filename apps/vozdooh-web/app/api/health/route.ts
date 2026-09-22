export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({
    service: 'vozdooh-web',
    status: 'ok',
  })
}
