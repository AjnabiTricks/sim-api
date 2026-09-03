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
    async function searchData(query, retryCount = 0) {
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
      }
      
      try {
        const response = await fetch('https://paksim.info/sim-database-online-2022-result.php', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'origin': 'https://paksim.info',
            'referer': 'https://paksim.info/search.php',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'ur,en-US;q=0.9,en;q=0.8',
            'cache-control': 'max-age=0',
            'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
          },
          body: new URLSearchParams({ cnnum: query })
        });

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          return [];
        }

        const html = await response.text();
        console.log(`📄 HTML Length: ${html.length}`);
        
        // Check if no data
        if (html.includes('No record found') || html.includes('No data found') || html.includes('not found')) {
          console.log('⚠️ No record found');
          return [];
        }
        
        // Parse using multiple methods
        let parsed = parsePaksimHTML(html);
        
        // If first method fails, try alternative
        if (!parsed || parsed.length === 0) {
          console.log('⚠️ Primary parsing failed, trying method 2...');
          parsed = parsePaksimHTMLAlt(html);
        }
        
        // If still fails, try raw text extraction
        if (!parsed || parsed.length === 0) {
          console.log('⚠️ Method 2 failed, trying raw extraction...');
          parsed = parseRawText(html);
        }
        
        console.log(`✅ Parsed ${parsed ? parsed.length : 0} records`);
        return parsed || [];
        
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
        suggestion: 'Number may not exist in database'
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

    console.log('📊 Unique Records:', JSON.stringify(uniqueData, null, 2));

    // =============================================
    // 🔥 SMART FILTERS
    // =============================================
    const finalName = getSmartName(uniqueData);
    const bestAddress = getSmartAddress(uniqueData);
    const allNumbers = getAllNumbers(uniqueData);
    const allCNICs = getAllCNICs(uniqueData);

    // =============================================
    // 📦 FINAL RESPONSE
    // =============================================
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
// 🔧 METHOD 1: Table Parser
// =============================================
function parsePaksimHTML(html) {
  try {
    const results = [];
    
    // Find any table
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    
    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHTML = tableMatch[1];
      
      // Find rows
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let isHeader = true;
      
      while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          let content = cellMatch[1]
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (content) {
            cells.push(content);
          }
        }
        
        // Check if this is a valid data row (has at least 3 cells)
        if (cells.length >= 3) {
          // Determine which cell is which
          let name = 'N/A', cnic = 'N/A', mobile = 'N/A', address = 'N/A';
          
          // Try to identify columns by content
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.match(/^[0-9]{13}$/)) {
              cnic = cell;
            } else if (cell.match(/^03[0-9]{9}$/)) {
              mobile = cell;
            } else if (cell.match(/[A-Za-z]/) && cell.length > 2 && !cell.match(/^[0-9]+$/)) {
              if (name === 'N/A') {
                name = cell;
              } else {
                address = cell;
              }
            }
          }
          
          // If we have at least name and mobile, add record
          if (name !== 'N/A' && mobile !== 'N/A') {
            results.push({ Name: name, Cnic: cnic, Mobile: mobile, Address: address });
          }
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Table parser error:', error);
    return [];
  }
}

// =============================================
// 🔧 METHOD 2: Alternative Parser
// =============================================
function parsePaksimHTMLAlt(html) {
  try {
    const results = [];
    
    // Extract all text between tags
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Look for patterns
    const lines = text.split(/[.\n]/);
    let currentRecord = {};
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 3) continue;
      
      // Check for CNIC (13 digits)
      const cnicMatch = trimmed.match(/\b([0-9]{13})\b/);
      if (cnicMatch) {
        currentRecord.Cnic = cnicMatch[1];
        continue;
      }
      
      // Check for Mobile (11 digits starting with 03)
      const mobileMatch = trimmed.match(/\b(03[0-9]{9})\b/);
      if (mobileMatch) {
        currentRecord.Mobile = mobileMatch[1];
        continue;
      }
      
      // Check for Name (alphabetic, 2+ words)
      if (trimmed.match(/^[A-Za-z]+ [A-Za-z]+/)) {
        if (currentRecord.Name && currentRecord.Mobile) {
          results.push({...currentRecord});
          currentRecord = {};
        }
        currentRecord.Name = trimmed;
        continue;
      }
      
      // Check for Address (long text with numbers)
      if (trimmed.length > 20 && trimmed.match(/[0-9]/)) {
        currentRecord.Address = trimmed;
      }
    }
    
    // Add last record if complete
    if (currentRecord.Name && currentRecord.Mobile) {
      results.push(currentRecord);
    }
    
    return results;
  } catch (error) {
    console.error('Alt parser error:', error);
    return [];
  }
}

// =============================================
// 🔧 METHOD 3: Raw Text Extraction
// =============================================
function parseRawText(html) {
  try {
    const results = [];
    
    // Remove scripts and styles
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[\s\S]*?<\/style>/gi, '');
    
    // Extract all text
    const text = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Find all 13-digit numbers (CNIC)
    const cnicMatches = text.match(/\b([0-9]{13})\b/g) || [];
    // Find all 11-digit numbers starting with 03 (Mobile)
    const mobileMatches = text.match(/\b(03[0-9]{9})\b/g) || [];
    
    // Find names (2+ words, alphabetic)
    const nameMatches = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) || [];
    
    // Find addresses (long text with numbers and words)
    const addressMatches = text.match(/\b([A-Z][a-z]+ [0-9]+ [A-Za-z\s,]+)/g) || [];
    
    // Combine into records
    const maxLen = Math.max(cnicMatches.length, mobileMatches.length, nameMatches.length);
    
    for (let i = 0; i < maxLen; i++) {
      const name = nameMatches[i] || 'Unknown';
      const cnic = cnicMatches[i] || 'N/A';
      const mobile = mobileMatches[i] || 'N/A';
      const address = addressMatches[i] || 'No address';
      
      if (mobile !== 'N/A') {
        results.push({ Name: name, Cnic: cnic, Mobile: mobile, Address: address });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Raw parser error:', error);
    return [];
  }
}

// =============================================
// 🔧 HELPER FUNCTIONS
// =============================================
function getSmartName(records) {
  const garbage = [
    'data not recieved from nadra', 
    'data not received from nadra', 
    'not received', 
    'no data', 
    'unknown', 
    'n/a', 
    'null', 
    'undefined', 
    'no', 
    '-',
    'cnic',
    'mobile',
    'address',
    'search'
  ];
  
  const names = records
    .map(r => r.Name)
    .filter(n => n && n.toString().trim().length > 0)
    .map(n => n.toString().trim());
  
  if (names.length === 0) return 'Unknown';
  
  const validNames = names.filter(name => {
    const lower = name.toLowerCase();
    return !garbage.some(g => lower.includes(g));
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

function getSmartAddress(records) {
  const garbage = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address'];
  let best = 'No address available';
  let maxLen = 0;
  
  records.forEach(r => {
    if (r.Address && r.Address.toString().trim().length > 0) {
      const addr = r.Address.toString().trim();
      const lower = addr.toLowerCase();
      
      if (!garbage.includes(lower) && addr.length > maxLen) {
        maxLen = addr.length;
        best = addr;
      }
    }
  });
  
  return best;
}

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
