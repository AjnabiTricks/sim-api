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

  // --- CLEAN INPUT (Remove spaces, dashes, plus signs, parentheses) ---
  let cleanInput = search.trim()
    .replace(/\s/g, '')           // Remove spaces
    .replace(/-/g, '')            // Remove dashes
    .replace(/\(/g, '')           // Remove opening parentheses
    .replace(/\)/g, '')           // Remove closing parentheses
    .replace(/\+/g, '');          // Remove plus sign

  // --- AUTO-DETECT LOGIC (Flexible) ---

  // 1. Check if it's a CNIC (13 digits, with or without dashes)
  //    Also handle 5-7-1 format: 36402-1274585-1
  const cnicMatch = cleanInput.match(/^([0-9]{5})?([0-9]{7})?([0-9]{1})?$/);
  const isCNIC = /^[0-9]{13}$/.test(cleanInput) || 
                 /^[0-9]{5}-[0-9]{7}-[0-9]{1}$/.test(search) ||
                 (cleanInput.length === 13 && /^[0-9]+$/.test(cleanInput));

  // 2. Check if it's a Phone Number (Various formats)
  //    Formats supported:
  //    - 03067898007 (11 digits, starts with 03)
  //    - 3067898007 (10 digits, without 0)
  //    - 923067898007 (with country code, without +)
  //    - +923067898007 (with +)
  //    - 92-306-7898007 (with dashes)
  let isPhone = false;
  let phoneNumber = cleanInput;

  // Remove country code if present (92 or 923)
  if (phoneNumber.startsWith('923')) {
    phoneNumber = phoneNumber.substring(3); // Remove 923
  } else if (phoneNumber.startsWith('92')) {
    phoneNumber = phoneNumber.substring(2); // Remove 92
  }

  // Check if it's a valid Pakistani phone number
  if (/^03[0-9]{9}$/.test(phoneNumber)) {
    isPhone = true;
  } else if (/^3[0-9]{9}$/.test(phoneNumber)) {
    // If number starts with 3 (without 0), add 0
    phoneNumber = '0' + phoneNumber;
    isPhone = true;
  } else if (/^[0-9]{10}$/.test(phoneNumber) && phoneNumber.startsWith('3')) {
    // If 10 digits starting with 3
    phoneNumber = '0' + phoneNumber;
    isPhone = true;
  }

  // Final validation
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
      // Use clean 13-digit CNIC
      const cnic = cleanInput.replace(/-/g, '');
      targetUrl = `https://adeel.app/api/search?cnic=${encodeURIComponent(cnic)}`;
    } else if (isPhone) {
      // Use formatted phone number (with 0)
      targetUrl = `https://adeel.app/api/search?phone=${encodeURIComponent(phoneNumber)}`;
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

    // --- ADD CREDIT ---
    const credit = {
      credit: "AZ Tricks",
      telegram: "https://t.me/AZ_Tricks"
    };

    // Final response
    const finalResponse = {
      success: data.success || true,
      query: data.query || search,
      type: data.type || (isCNIC ? 'cnic' : 'phone'),
      total: Array.isArray(formattedData) ? formattedData.length : 1,
      data: formattedData,
      ...credit
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
