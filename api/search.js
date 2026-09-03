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
    
    console.log(`📄 HTML Length: ${html.length}`);

    // --- PARSE HTML ---
    let parsedData = parsePaksimHTML(html);
    
    if (!parsedData || parsedData.length === 0) {
      parsedData = parsePaksimHTMLAlt(html);
    }

    console.log(`📊 Parsed Data Count: ${parsedData ? parsedData.length : 0}`);

    if (!parsedData || parsedData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found for this phone number',
        query: phoneNumber
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

    // =============================================
    // 🔥 SMART NAME FILTER - IGNORE GARBAGE
    // =============================================
    function getSmartName(records) {
      const garbageNames = [
        'data not recieved from nadra',
        'data not received from nadra',
        'not received from nadra',
        'not recieved from nadra',
        'data not recieved',
        'data not received',
        'not received',
        'no data',
        'unknown',
        'n/a',
        'null',
        'undefined',
        'no',
        '-',
        'data not recieved from'
      ];
      
      const names = records
        .map(r => r.Name)
        .filter(name => name && name.toString().trim().length > 0)
        .map(name => name.toString().trim());
      
      if (names.length === 0) return 'Unknown';
      
      const validNames = names.filter(name => {
        const lower = name.toLowerCase();
        return !garbageNames.some(garbage => lower.includes(garbage));
      });
      
      if (validNames.length === 0) {
        return names[0];
      }
      
      const nameCount = {};
      validNames.forEach(name => {
        nameCount[name] = (nameCount[name] || 0) + 1;
      });
      
      let mostCommon = validNames[0];
      let maxCount = 0;
      Object.keys(nameCount).forEach(name => {
        if (nameCount[name] > maxCount) {
          maxCount = nameCount[name];
          mostCommon = name;
        }
      });
      
      return mostCommon;
    }

    // =============================================
    // 🏠 SMART ADDRESS FILTER
    // =============================================
    function getSmartAddress(records) {
      const garbageAddresses = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address', 'nill'];
      
      let bestAddress = 'No address available';
      let maxLength = 0;
      
      records.forEach(record => {
        if (record.Address && record.Address.toString().trim().length > 0) {
          const addr = record.Address.toString().trim();
          const lower = addr.toLowerCase();
          
          if (garbageAddresses.includes(lower)) return;
          
          if (addr.length > maxLength) {
            maxLength = addr.length;
            bestAddress = addr;
          }
        }
      });
      
      return bestAddress;
    }

    // =============================================
    // 📊 EXTRACT ALL NUMBERS & CNICS
    // =============================================
    function getAllNumbers(records) {
      const numbers = records
        .map(r => r.Mobile)
        .filter(n => n && n.toString().trim().length > 0)
        .map(n => n.toString().trim());
      return [...new Set(numbers)];
    }

    function getAllCNICs(records) {
      const cnis = records
        .map(r => r.Cnic)
        .filter(c => c && c.toString().trim().length > 0)
        .map(c => c.toString().trim());
      return [...new Set(cnis)];
    }

    // =============================================
    // ✅ APPLY FILTERS
    // =============================================
    const finalName = getSmartName(uniqueData);
    const bestAddress = getSmartAddress(uniqueData);
    const allNumbers = getAllNumbers(uniqueData);
    const allCNICs = getAllCNICs(uniqueData);

    // =============================================
    // 📦 FORMAT FINAL RESPONSE
    // =============================================
    const formattedData = {
      name: finalName,
      allNumbers: allNumbers,
      cnic: allCNICs[0] || null,
      allCNICs: allCNICs,
      completeAddress: bestAddress,
      totalRecords: uniqueData.length,
      records: uniqueData.map(item => ({
        name: item.Name,
        cnic: item.Cnic,
        number: item.Mobile,
        address: item.Address
      }))
    };

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
    
    const tableStart = html.indexOf('<table');
    const tableEnd = html.indexOf('</table>', tableStart);
    
    if (tableStart === -1 || tableEnd === -1) {
      console.log('❌ No table found');
      return results;
    }

    const tableHTML = html.substring(tableStart, tableEnd + 8);
    
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

// --- METHOD 2: Alternative parsing ---
function parsePaksimHTMLAlt(html) {
  try {
    const results = [];
    
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
