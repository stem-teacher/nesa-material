"use strict";

const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

// Check if the file is a DOC, DOCX, or PDF file
function isDocOrPdf(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".docx" || ext === ".pdf" || ext === ".doc";
}

// Recursively list files in a directory that match DOC/PDF criteria, returning paths relative to baseDir
async function listFiles(dir, baseDir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (let item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      const subfiles = await listFiles(fullPath, baseDir);
      results = results.concat(subfiles);
    } else {
      if (isDocOrPdf(item.name)) {
        const relPath = path.relative(baseDir, fullPath);
        results.push(relPath);
      }
    }
  }
  return results;
}

// Convert PDF to text using pdftotext
async function convertPdfToText(pdfFile, textFile) {
  const command = `pdftotext -layout "${pdfFile}" "${textFile}"`;
  try {
    console.log(`Converting PDF to text: ${pdfFile} -> ${textFile}`);
    await execAsync(command);
    return true;
  } catch (err) {
    console.error(`Error converting PDF ${pdfFile}:`, err);
    return false;
  }
}

// Convert a file using appropriate method based on file type
async function convertFile(srcFile, destFile) {
  await fs.mkdir(path.dirname(destFile), { recursive: true });

  const ext = path.extname(srcFile).toLowerCase();

  try {
    if (ext === ".pdf") {
      // For PDF files, first convert to text, then to markdown
      const tempTextFile = destFile.replace(/\.md$/, ".txt");
      const success = await convertPdfToText(srcFile, tempTextFile);

      if (success) {
        // Convert the text file to markdown
        const command = `pandoc "${tempTextFile}" -t markdown --wrap=none -o "${destFile}"`;
        console.log(
          `Converting text to markdown: ${tempTextFile} -> ${destFile}`,
        );
        await execAsync(command);

        // Clean up temporary text file
        await fs.unlink(tempTextFile);
      }
    } else {
      // For DOC/DOCX files, use pandoc directly
      const command = `pandoc "${srcFile}" -s -t markdown --wrap=none -o "${destFile}"`;
      console.log(`Converting ${srcFile} -> ${destFile}`);
      await execAsync(command);
    }
  } catch (err) {
    console.error(`Error converting ${srcFile}:`, err);
  }
}

// Generate an index.md file in the specified output directory listing all markdown files
async function generateIndex(outDir) {
  async function getMarkdownFiles(directory) {
    let filesList = [];
    const items = await fs.readdir(directory, { withFileTypes: true });
    for (let item of items) {
      const fullPath = path.join(directory, item.name);
      if (item.isDirectory()) {
        filesList = filesList.concat(await getMarkdownFiles(fullPath));
      } else {
        if (
          path.extname(item.name).toLowerCase() === ".md" &&
          item.name !== "index.md"
        ) {
          filesList.push(path.relative(outDir, fullPath));
        }
      }
    }
    return filesList;
  }

  const mdFiles = await getMarkdownFiles(outDir);
  let indexContent = "# Index of Automated Markdown Files\n\n";
  for (let file of mdFiles) {
    indexContent += `* [${file}](${file.replace(/\\/g, "/")})\n`;
  }
  const indexPath = path.join(outDir, "index.md");
  await fs.writeFile(indexPath, indexContent, "utf-8");
  console.log(`Index generated at ${indexPath}`);
}

// Process an individual subject directory by converting all source files and generating its index page
async function processSubject(subjectDir) {
  const srcDir = path.join(subjectDir, "src");
  const outDir = path.join(subjectDir, "md-automated");
  try {
    await fs.access(srcDir);
    await fs.access(outDir);
  } catch (err) {
    console.warn(
      `Skipping ${subjectDir} as it doesn't have both 'src' and 'md-automated' directories.`,
    );
    return;
  }
  // List all DOCX/PDF files within the src folder recursively
  const files = await listFiles(srcDir, srcDir);
  for (let relPath of files) {
    const srcFile = path.join(srcDir, relPath);
    const destRel = relPath.replace(/\.(docx|pdf|doc)$/i, ".md");
    const destFile = path.join(outDir, destRel);
    await convertFile(srcFile, destFile);
  }
  // Generate an index page for all converted markdown files in the subject's md-automated folder
  await generateIndex(outDir);
}

// Generate a top-level index.md that links to each subject's md-automated index page
async function generateTopLevelIndex(baseDir, subjects) {
  let content = "# NESA Material Subjects Index\n\n";
  for (let subject of subjects) {
    const subjectIndexPath = path.join(subject, "md-automated", "index.md");
    content += `* [${path.basename(subject)}](${subjectIndexPath.replace(/\\/g, "/")})\n`;
  }
  const indexPath = path.join(baseDir, "index.md");
  await fs.writeFile(indexPath, content, "utf-8");
  console.log(`Top-level index generated at ${indexPath}`);
}

// Main function to process all subject directories in the base directory
async function main() {
  const baseDir = process.cwd();
  const items = await fs.readdir(baseDir, { withFileTypes: true });
  let subjectDirs = [];
  for (let item of items) {
    if (item.isDirectory()) {
      const subjectPath = path.join(baseDir, item.name);
      const srcPath = path.join(subjectPath, "src");
      const mdAutoPath = path.join(subjectPath, "md-automated");
      try {
        await fs.access(srcPath);
        await fs.access(mdAutoPath);
        subjectDirs.push(subjectPath);
      } catch (err) {
        // Skip directories that don't have the required structure
      }
    }
  }
  // Process each subject directory one by one
  for (let subject of subjectDirs) {
    console.log(`Processing subject directory: ${subject}`);
    await processSubject(subject);
  }
  // Generate a top-level index page linking to each subject's index.md
  await generateTopLevelIndex(baseDir, subjectDirs);
}

main().catch((err) => {
  console.error("Error in conversion process:", err);
});
