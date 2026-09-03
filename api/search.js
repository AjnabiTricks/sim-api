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
    // 📞 SEARCH FUNCTION
    // =============================================
    async function searchData(query) {
      try {
        const response = await fetch('https://paksim.info/sim-database-online-2022-result.php', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
            'origin': 'https://paksim.info',
            'referer': 'https://paksim.info/search.php',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'ur,en-US;q=0.9,en;q=0.8',
            'cache-control': 'max-age=0',
            'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"'
          },
          body: new URLSearchParams({ cnnum: query })
        });

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          return [];
        }

        const html = await response.text();
        console.log(`📄 HTML Length: ${html.length}`);
        
        // Save HTML for debugging (first 500 chars)
        console.log(`📄 HTML Preview: ${html.substring(0, 500)}...`);
        
        return parsePaksimHTML(html);
        
      } catch (error) {
        console.error('Search error:', error);
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
        error: 'No data found. Try another number.',
        query: search,
        suggestion: 'Check if number is correct or try different network provider'
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
// 🔧 UPDATED PARSER - Supports New Paksim Structure
// =============================================
function parsePaksimHTML(html) {
  try {
    const results = [];
    
    // Method 1: Try to find data in script tags or JSON
    const jsonMatch = html.match(/var\s+data\s*=\s*(\[[\s\S]*?\]);/);
    if (jsonMatch) {
      try {
        const jsonData = JSON.parse(jsonMatch[1]);
        if (Array.isArray(jsonData) && jsonData.length > 0) {
          return jsonData.map(item => ({
            Name: item.name || item.Name || 'N/A',
            Cnic: item.cnic || item.Cnic || 'N/A',
            Mobile: item.mobile || item.Mobile || 'N/A',
            Address: item.address || item.Address || 'N/A'
          }));
        }
      } catch (e) {}
    }

    // Method 2: Find table with specific classes
    const tableRegex = /<table[^>]*class=["']([^"']*table[^"']*)["'][^>]*>([\s\S]*?)<\/table>/i;
    const tableMatch = html.match(tableRegex);
    
    if (tableMatch) {
      const tableHTML = tableMatch[2];
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
      
      if (results.length > 0) return results;
    }

    // Method 3: Look for div-based structure
    const divRegex = /<div[^>]*class=["']([^"']*result[^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi;
    let divMatch;
    let tempData = {};
    let tempResults = [];
    
    while ((divMatch = divRegex.exec(html)) !== null) {
      const content = divMatch[2];
      
      const nameMatch = content.match(/Name[:\s]*([^<]*)/i);
      if (nameMatch) tempData.Name = nameMatch[1].trim();
      
      const cnicMatch = content.match(/CNIC[:\s]*([^<]*)/i);
      if (cnicMatch) tempData.Cnic = cnicMatch[1].trim();
      
      const mobileMatch = content.match(/Mobile[:\s]*([^<]*)/i);
      if (mobileMatch) tempData.Mobile = mobileMatch[1].trim();
      
      const addressMatch = content.match(/Address[:\s]*([^<]*)/i);
      if (addressMatch) tempData.Address = addressMatch[1].trim();
      
      if (tempData.Name && tempData.Mobile) {
        tempResults.push({...tempData});
        tempData = {};
      }
    }
    
    if (tempResults.length > 0) return tempResults;

    // Method 4: Direct text extraction (Last resort)
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = text.split(/\n|\.\s+/);
    
    let currentRecord = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (trimmed.match(/[A-Za-z]+\s+[A-Za-z]+/)) {
        if (currentRecord.Name) {
          if (currentRecord.Name && currentRecord.Mobile) {
            results.push({...currentRecord});
          }
          currentRecord = {};
        }
        currentRecord.Name = trimmed;
      } else if (trimmed.match(/[0-9]{13}/)) {
        currentRecord.Cnic = trimmed;
      } else if (trimmed.match(/03[0-9]{9}/)) {
        currentRecord.Mobile = trimmed;
      } else if (trimmed.length > 5) {
        currentRecord.Address = trimmed;
      }
    }
    
    if (currentRecord.Name && currentRecord.Mobile) {
      results.push(currentRecord);
    }

    console.log(`✅ Parsed ${results.length} records`);
    return results;
    
  } catch (error) {
    console.error('Parse error:', error);
    return [];
  }
}

// =============================================
// 🔧 HELPER FUNCTIONS
// =============================================
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
