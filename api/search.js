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
      error: 'Please provide "search" parameter (Phone number)'
    });
  }

  // --- CLEAN INPUT ---
  let cleanInput = search.trim()
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\+/g, '');

  // --- PHONE NUMBER FORMATTING ---
  let phoneNumber = cleanInput;

  if (phoneNumber.startsWith('923')) {
    phoneNumber = phoneNumber.substring(3);
  } else if (phoneNumber.startsWith('92')) {
    phoneNumber = phoneNumber.substring(2);
  }

  if (/^3[0-9]{9}$/.test(phoneNumber)) {
    phoneNumber = '0' + phoneNumber;
  } else if (/^[0-9]{10}$/.test(phoneNumber) && phoneNumber.startsWith('3')) {
    phoneNumber = '0' + phoneNumber;
  }

  if (!/^03[0-9]{9}$/.test(phoneNumber)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid phone number. Must be 11 digits starting with 03'
    });
  }

  try {
    console.log(`🔍 Searching for: ${phoneNumber}`);

    const paksimResponse = await fetch('https://paksim.info/sim-database-online-2022-result.php', {
      method: 'POST',
      headers: {
        'host': 'paksim.info',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
        'origin': 'https://paksim.info',
        'referer': 'https://paksim.info/search.php',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'ur,en-US;q=0.9,en;q=0.8',
        'cache-control': 'max-age=0',
        'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-user': '?1',
        'sec-fetch-dest': 'document',
        'upgrade-insecure-requests': '1',
        'priority': 'u=0, i'
      },
      body: new URLSearchParams({
        cnnum: phoneNumber
      })
    });

    if (!paksimResponse.ok) {
      console.error(`❌ HTTP Error: ${paksimResponse.status}`);
      throw new Error(`HTTP error! status: ${paksimResponse.status}`);
    }

    const html = await paksimResponse.text();
    
    // --- DEBUG: Log HTML ---
    console.log(`📄 HTML Length: ${html.length}`);
    console.log(`📄 HTML Preview (first 1000 chars):\n${html.substring(0, 1000)}...`);

    // --- PARSE HTML using multiple methods ---
    let parsedData = parsePaksimHTML(html);
    
    // If first method fails, try alternative
    if (!parsedData || parsedData.length === 0) {
      console.log('⚠️ Primary parsing failed, trying alternative method...');
      parsedData = parsePaksimHTMLAlt(html);
    }

    console.log(`📊 Parsed Data Count: ${parsedData ? parsedData.length : 0}`);

    if (!parsedData || parsedData.length === 0) {
      // Return HTML snippet for debugging
      return res.status(404).json({
        success: false,
        error: 'No data found for this phone number',
        query: phoneNumber,
        debug: {
          htmlLength: html.length,
          htmlSnippet: html.substring(0, 500)
        }
      });
    }

    // --- REMOVE DUPLICATES ---
    const seenRecords = new Set();
    const uniqueData = parsedData.filter(item => {
      const key = `${item.Cnic}_${item.Name}`;
      if (!seenRecords.has(key)) {
        seenRecords.add(key);
        return true;
      }
      return false;
    });

    // --- FORMAT RESPONSE ---
    let formattedData;
    if (uniqueData.length === 1) {
      const item = uniqueData[0];
      formattedData = {
        Name: item.Name,
        Cnic: item.Cnic,
        Mobile: item.Mobile,
        Address: item.Address
      };
    } else {
      formattedData = uniqueData.map(item => ({
        Name: item.Name,
        Cnic: item.Cnic,
        Mobile: item.Mobile,
        Address: item.Address
      }));
    }

    // --- CREDIT ---
    const credit = {
      credit: "AZ Tricks",
      telegram: "https://t.me/AZ_Tricks"
    };

    // --- FINAL RESPONSE ---
    const finalResponse = {
      success: true,
      query: phoneNumber,
      type: 'phone',
      total: uniqueData.length,
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

// --- METHOD 1: Regex-based parsing ---
function parsePaksimHTML(html) {
  try {
    const results = [];
    
    // Find table
    const tableStart = html.indexOf('<table');
    const tableEnd = html.indexOf('</table>', tableStart);
    
    if (tableStart === -1 || tableEnd === -1) {
      console.log('❌ No table found');
      return results;
    }

    const tableHTML = html.substring(tableStart, tableEnd + 8);
    
    // Extract rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    
    let rowMatch;
    let isHeader = true;
    
    while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
      if (isHeader) {
        isHeader = false;
        continue;
      }
      
      const row = rowMatch[1];
      const cells = [];
      let cellMatch;
      
      while ((cellMatch = cellRegex.exec(row)) !== null) {
        let content = cellMatch[1]
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(content);
      }
      
      if (cells.length >= 4) {
        results.push({
          Name: cells[0] || 'N/A',
          Cnic: cells[1] || 'N/A',
          Mobile: cells[2] || 'N/A',
          Address: cells[3] || 'N/A'
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Parse error:', error);
    return null;
  }
}

// --- METHOD 2: Alternative parsing (simple string split) ---
function parsePaksimHTMLAlt(html) {
  try {
    const results = [];
    
    // Look for pattern: <td>Name</td><td>CNIC</td><td>Mobile</td><td>Address</td>
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const allCells = [];
    let match;
    
    while ((match = tdRegex.exec(html)) !== null) {
      let content = match[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (content) {
        allCells.push(content);
      }
    }
    
    // Group cells into records (4 cells per record)
    for (let i = 0; i < allCells.length; i += 4) {
      if (i + 3 < allCells.length) {
        results.push({
          Name: allCells[i] || 'N/A',
          Cnic: allCells[i+1] || 'N/A',
          Mobile: allCells[i+2] || 'N/A',
          Address: allCells[i+3] || 'N/A'
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Alt parse error:', error);
    return null;
  }
}
