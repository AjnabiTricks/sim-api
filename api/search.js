export default async function handler(req, res) {
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
      error: 'Please provide "search" parameter'
    });
  }

  // --- CLEAN INPUT ---
  let cleanInput = search.trim()
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\+/g, '');

  let isCNIC = /^[0-9]{13}$/.test(cleanInput);
  let phoneNumber = cleanInput;

  if (!isCNIC) {
    if (phoneNumber.startsWith('923')) phoneNumber = phoneNumber.substring(3);
    else if (phoneNumber.startsWith('92')) phoneNumber = phoneNumber.substring(2);
    if (/^3[0-9]{9}$/.test(phoneNumber)) phoneNumber = '0' + phoneNumber;
    else if (/^[0-9]{10}$/.test(phoneNumber) && phoneNumber.startsWith('3')) phoneNumber = '0' + phoneNumber;
    
    if (!/^03[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number. Must be 11 digits starting with 03'
      });
    }
  }

  try {
    console.log(`🔍 Searching for: ${phoneNumber}`);

    // =============================================
    // 📞 SEARCH FUNCTION WITH DELAY & ROTATING UA
    // =============================================
    async function searchData(query, retryCount = 0) {
      // ⏰ Add delay to avoid rate limiting
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000 * retryCount));
      }
      
      // 🔄 Rotate user agents
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      ];
      
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
      
      try {
        const response = await fetch('https://paksim.info/sim-database-online-2022-result.php', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': randomUA,
            'origin': 'https://paksim.info',
            'referer': 'https://paksim.info/search.php',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'ur,en-US;q=0.9,en;q=0.8',
            'cache-control': 'max-age=0',
            'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-user': '?1',
            'sec-fetch-dest': 'document',
            'upgrade-insecure-requests': '1',
            'priority': 'u=0, i'
          },
          body: new URLSearchParams({ cnnum: query })
        });

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          if (response.status === 429 || response.status === 403) {
            // Rate limited - retry with longer delay
            if (retryCount < 3) {
              console.log(`⚠️ Rate limited, retrying... (${retryCount + 1})`);
              return searchData(query, retryCount + 1);
            }
          }
          return [];
        }

        const html = await response.text();
        console.log(`📄 HTML Length: ${html.length}`);
        
        // Check if "No record found" message exists
        if (html.includes('No record found') || html.includes('No data found') || html.includes('not found')) {
          console.log('⚠️ Paksim says: No record found');
          return [];
        }
        
        // Check if blocked
        if (html.includes('blocked') || html.includes('security') || html.includes('captcha')) {
          console.log('🚫 Paksim blocked the request');
          if (retryCount < 3) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            return searchData(query, retryCount + 1);
          }
          return [];
        }
        
        const parsed = parsePaksimHTML(html);
        console.log(`✅ Parsed ${parsed.length} records`);
        return parsed;
        
      } catch (error) {
        console.error('Search error:', error);
        if (retryCount < 2) {
          console.log(`🔄 Retrying... (${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return searchData(query, retryCount + 1);
        }
        return [];
      }
    }

    // =============================================
    // 🔍 SEARCH LOGIC
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    if (isCNIC) {
      const records = await searchData(cleanInput);
      if (records.length > 0) {
        allRecords = records;
        detectedCNIC = cleanInput;
      }
    } else {
      const phoneRecords = await searchData(phoneNumber);
      if (phoneRecords.length > 0) {
        allRecords = phoneRecords;
        
        const cnis = getAllCNICs(phoneRecords);
        if (cnis.length > 0) {
          detectedCNIC = cnis[0];
          console.log(`📌 Found CNIC: ${detectedCNIC}`);
          
          const cnicRecords = await searchData(detectedCNIC);
          if (cnicRecords.length > 0) {
            const existingNumbers = new Set(allRecords.map(r => r.Mobile));
            cnicRecords.forEach(record => {
              if (!existingNumbers.has(record.Mobile)) {
                allRecords.push(record);
                existingNumbers.add(record.Mobile);
              }
            });
          }
        }
      }
    }

    // =============================================
    // 📊 PROCESS RESULTS
    // =============================================
    if (!allRecords || allRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found. Try another number or wait a few minutes.',
        query: search,
        suggestion: 'Paksim.info might be rate limiting. Try after 2-3 minutes.'
      });
    }

    // Remove duplicates
    const seen = new Set();
    const uniqueData = allRecords.filter(item => {
      const key = `${item.Cnic}_${item.Mobile}`;
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      return false;
    });

    const finalName = getSmartName(uniqueData);
    const bestAddress = getSmartAddress(uniqueData);
    const allNumbers = getAllNumbers(uniqueData);
    const allCNICs = getAllCNICs(uniqueData);

    const finalResponse = {
      success: true,
      query: isCNIC ? cleanInput : phoneNumber,
      detectedType: isCNIC ? 'cnic' : 'phone',
      data: {
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
      },
      credit: "AZ Tricks",
      telegram: "https://t.me/AZ_Tricks"
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

// =============================================
// 🔧 PARSER FUNCTIONS (same as before)
// =============================================
function parsePaksimHTML(html) {
  try {
    const results = [];
    
    // Method 1: Table parsing
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/i;
    const tableMatch = html.match(tableRegex);
    
    if (tableMatch) {
      const tableHTML = tableMatch[1];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      
      let rowMatch;
      let isHeader = true;
      
      while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        
        const cells = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
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
      
      if (results.length > 0) {
        console.log(`✅ Table parser found ${results.length} records`);
        return results;
      }
    }

    // Method 2: Alternative parsing
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
    
    console.log(`✅ Alternative parser found ${results.length} records`);
    return results;
    
  } catch (error) {
    console.error('Parse error:', error);
    return [];
  }
}

function getSmartName(records) {
  const garbage = ['data not recieved from nadra', 'data not received from nadra', 'not received', 'no data', 'unknown', 'n/a', 'null', 'undefined', 'no', '-'];
  const names = records.map(r => r.Name).filter(n => n && n.trim().length > 0).map(n => n.trim());
  if (names.length === 0) return 'Unknown';
  
  const valid = names.filter(n => !garbage.some(g => n.toLowerCase().includes(g)));
  if (valid.length === 0) return names[0];
  
  const count = {};
  valid.forEach(n => count[n] = (count[n] || 0) + 1);
  return Object.keys(count).reduce((a, b) => count[a] > count[b] ? a : b);
}

function getSmartAddress(records) {
  const garbage = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address'];
  let best = 'No address available';
  let maxLen = 0;
  
  records.forEach(r => {
    if (r.Address && r.Address.trim().length > 0) {
      const addr = r.Address.trim();
      if (!garbage.includes(addr.toLowerCase()) && addr.length > maxLen) {
        maxLen = addr.length;
        best = addr;
      }
    }
  });
  return best;
}

function getAllNumbers(records) {
  const numbers = records.map(r => r.Mobile).filter(n => n && n.trim().length > 0).map(n => n.trim());
  return [...new Set(numbers)];
}

function getAllCNICs(records) {
  const cnis = records.map(r => r.Cnic).filter(c => c && c.trim().length > 0).map(c => c.trim());
  return [...new Set(cnis)];
      }
