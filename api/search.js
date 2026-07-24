export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { search } = req.query;

  if (!search) {
    return res.status(400).json({
      success: false,
      error: 'Please provide "search" parameter (CNIC or Phone number)'
    });
  }

  // Auto-detect: CNIC (13 digits) or Phone (11 digits starting with 03)
  const cleanInput = search.trim().replace(/\s/g, '');
  const isCNIC = /^[0-9]{13}$/.test(cleanInput);
  const isPhone = /^03[0-9]{9}$/.test(cleanInput);

  if (!isCNIC && !isPhone) {
    return res.status(400).json({
      success: false,
      error: 'Invalid format. CNIC must be 13 digits, Phone must be 11 digits starting with 03'
    });
  }

  try {
    // Build target URL
    let targetUrl;
    if (isCNIC) {
      targetUrl = `https://adeel.app/api/search?cnic=${encodeURIComponent(cleanInput)}`;
    } else if (isPhone) {
      targetUrl = `https://adeel.app/api/search?phone=${encodeURIComponent(cleanInput)}`;
    }

    // Forward request
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Not;A=Brand";v="8", "Chromium";v="150"',
        'Sec-Ch-Ua-Mobile': '?1',
        'Sec-Ch-Ua-Platform': '"Android"',
        'Referer': 'https://adeel.app/',
        'X-Requested-With': 'mark.via.gp'
      }
    });

    const data = await response.json();

    // --- REMOVE DUPLICATES (by Mobile number) ---
    let formattedData;
    const seenMobiles = new Set();

    if (Array.isArray(data.data)) {
      // CNIC search returns array
      formattedData = data.data
        .filter(item => {
          const mobile = item.Mobile || '';
          if (mobile && !seenMobiles.has(mobile)) {
            seenMobiles.add(mobile);
            return true;
          }
          return false;
        })
        .map(item => ({
          Name: item.Name || 'N/A',
          Cnic: item.CNIC || 'N/A',
          Mobile: item.Mobile || 'N/A',
          Address: item.ADDRESS || 'N/A'
        }));
    } else if (data.data && typeof data.data === 'object') {
      // Phone search returns single object
      const item = data.data;
      formattedData = {
        Name: item.Name || 'N/A',
        Cnic: item.CNIC || 'N/A',
        Mobile: item.Mobile || 'N/A',
        Address: item.ADDRESS || 'N/A'
      };
    } else {
      formattedData = data.data || null;
    }

    // --- ADD CREDIT (Always at the end) ---
    const credit = {
      credit: "AZ Tricks",
      telegram: "https://t.me/AZ_Tricks"
    };

    // Final response structure
    const finalResponse = {
      success: data.success || true,
      query: data.query || search,
      type: data.type || (isCNIC ? 'cnic' : 'phone'),
      total: Array.isArray(formattedData) ? formattedData.length : 1,
      data: formattedData,
      ...credit  // Credit added at the end
    };

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message
    });
  }
        }
