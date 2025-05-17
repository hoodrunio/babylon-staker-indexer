const fs = require('fs');
const path = require('path');

// Paths
const sourceDir = path.resolve(__dirname, '../../src/generated');
const targetDir = path.resolve(__dirname, '../../dist/generated');

/**
 * Copy directory recursively
 */
function copyDir(src, dest) {
  // Create destination directory if it doesn't exist
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  // Read source directory
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      // Recursively copy subdirectories
      copyDir(srcPath, destPath);
    } else {
      // Copy files
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Main execution
console.log('Copying proto files from src/generated to dist/generated...');
try {
  copyDir(sourceDir, targetDir);
  console.log('Proto files copied successfully!');
} catch (error) {
  console.error('Error copying proto files:', error);
  process.exit(1);
}
