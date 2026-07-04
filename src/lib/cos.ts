import COS from 'cos-nodejs-sdk-v5'

let cosInstance: COS | null = null

function getCos(): COS | null {
  if (cosInstance !== null) return cosInstance
  const secretId = process.env.COS_SECRET_ID
  const secretKey = process.env.COS_SECRET_KEY
  const bucket = process.env.COS_BUCKET
  const region = process.env.COS_REGION
  if (!secretId || !secretKey || !bucket || !region) return null
  cosInstance = new COS({ SecretId: secretId, SecretKey: secretKey })
  return cosInstance
}

export function isCosConfigured(): boolean {
  return getCos() !== null
}

export async function uploadToCos(buffer: Buffer, key: string, contentType: string): Promise<string | null> {
  const cos = getCos()
  if (!cos) return null
  const bucket = process.env.COS_BUCKET!
  const region = process.env.COS_REGION!
  await cos.putObject({
    Bucket: bucket,
    Region: region,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  })
  return `https://${bucket}.cos.${region}.myqcloud.com/${key}`
}

export async function deleteFromCos(key: string): Promise<void> {
  const cos = getCos()
  if (!cos) return
  const bucket = process.env.COS_BUCKET!
  const region = process.env.COS_REGION!
  await cos.deleteObject({ Bucket: bucket, Region: region, Key: key })
}
