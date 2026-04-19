import Cloudflare from 'cloudflare';
import 'dotenv/config';

const client = new Cloudflare({
    apiToken: process.env['API_TOKEN'],
});

const zones = await client.zones.list();
zones.result.forEach(z => console.log(z.name, z.id));

// Step 1: List all DNS records to find the record ID
const records = await client.dns.records.list({
    zone_id: process.env['ZONE_ID']!,
    //name: 'cloudisy.top',

    type: 'A',
});

console.log('Found records:', records.result);

// Step 2: Get the ID of the first matching record
const recordId = records.result[0]?.id;

if (!recordId) {
    throw new Error('No matching DNS record found');
}

// Step 3: Edit the record
const recordResponse = await client.dns.records.edit(recordId, {
    zone_id: process.env['ZONE_ID']!,
    name: 'cloudisy.top',
    ttl: 60,
    type: 'A',
    //content: '103.78.41.71',
});

console.log('Updated record:', recordResponse);
