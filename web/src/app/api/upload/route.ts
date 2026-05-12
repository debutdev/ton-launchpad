import { NextRequest, NextResponse } from 'next/server';

// This runs server-side only — Pinata keys are never exposed to the browser
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string;
    const symbol = formData.get('symbol') as string;
    const description = formData.get('description') as string;
    const twitter = formData.get('twitter') as string | null;
    const telegram = formData.get('telegram') as string | null;
    const website = formData.get('website') as string | null;

    let imageUrl = '';

    // 1. Upload image to IPFS if provided
    if (file && file.size > 0) {
      const pinataForm = new FormData();
      pinataForm.append('file', file);
      pinataForm.append('pinataMetadata', JSON.stringify({ name: `${symbol}_logo` }));

      const imgRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
          'pinata_api_key': process.env.PINATA_API_KEY!,
          'pinata_secret_api_key': process.env.PINATA_API_SECRET!,
        },
        body: pinataForm,
      });

      if (!imgRes.ok) {
        const err = await imgRes.text();
        return NextResponse.json({ error: `Image upload failed: ${err}` }, { status: 500 });
      }

      const imgData = await imgRes.json();
      imageUrl = `ipfs://${imgData.IpfsHash}`;
    }

    // 2. Upload metadata JSON to IPFS
    const metadata = {
      name,
      symbol,
      description,
      image: imageUrl,
      decimals: 9,
      twitter: twitter || '',
      telegram: telegram || '',
      website: website || '',
    };

    const metaRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': process.env.PINATA_API_KEY!,
        'pinata_secret_api_key': process.env.PINATA_API_SECRET!,
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: `${symbol}_metadata` },
      }),
    });

    if (!metaRes.ok) {
      const err = await metaRes.text();
      return NextResponse.json({ error: `Metadata upload failed: ${err}` }, { status: 500 });
    }

    const metaData = await metaRes.json();
    const metadataUrl = `ipfs://${metaData.IpfsHash}`;

    return NextResponse.json({
      metadataUrl,
      imageUrl,
      ipfsHash: metaData.IpfsHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
