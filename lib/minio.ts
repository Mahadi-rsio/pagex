import * as Minio from 'minio';
import 'dotenv/config'


export const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT!,
    port: parseInt(process.env.MINIO_PORT!) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY!,
    secretKey: process.env.MINIO_SECRET_KEY!
});


async function changeToPublicPolicy(bucketName: string) {
    const policy = {
        Version: '2012-10-17',
        Statement: [
            {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetBucketLocation', 's3:ListBucket'],
                Resource: [`arn:aws:s3:::${bucketName}`],
            },
            {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucketName}/*`],
            },
        ],
    };

    // Apply the policy
    await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    console.log(`🔓 Bucket "${bucketName}" is now public (Read-Only).`);

}


export async function createPageBucket(projectName: string) {

    try {
        const exists = await minioClient.bucketExists(projectName);

        if (!exists) {
            await minioClient.makeBucket(projectName);
            console.log(`✅ Bucket "${projectName}" created.`);
        } else {

            console.log(`ℹ️ Bucket "${projectName}" already exists.`);
        }
        await changeToPublicPolicy(projectName)

    } catch (error) {
        console.error('❌ Error:', error);
    }
}


