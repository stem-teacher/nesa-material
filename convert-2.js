"use strict";

const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

// Outcome structure definition
class LearningOutcome {
  constructor(id, content, sectionName) {
    this.id = id;
    this.content = content;
    this.sectionName = sectionName;
  }
}

// Check if the file is a DOC, DOCX, or PDF file
function isDocOrPdf(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === ".docx" || ext === ".pdf" || ext === ".doc";
}

// Clean up formatting in text content
function cleanFormatting(content) {
  // Remove LaTeX-style formatting
  content = content.replace(/\$([^$]+)\$/g, "$1");

  // Clean up special characters
  content = content
    .replace(/'/g, "'")
    .replace(/"/g, '"')
    .replace(/--/g, "–")
    .replace(/\[\{\.underline\}\]/g, "");

  // Clean up tables
  const lines = content.split("\n");
  let inTable = false;
  let tableLines = [];
  const processedLines = [];

  for (const line of lines) {
    if (isASCIITableBorder(line)) {
      if (!inTable) {
        inTable = true;
        tableLines = [line];
      } else {
        tableLines.push(line);
        processedLines.push(...convertToMarkdownTable(tableLines));
        inTable = false;
        tableLines = [];
      }
      continue;
    }

    if (inTable) {
      tableLines.push(line);
      continue;
    }

    processedLines.push(line);
  }

  return processedLines.join("\n");
}

function isASCIITableBorder(line) {
  return line.includes("-") && line.includes("+") && line.split("-").length > 3;
}

function convertToMarkdownTable(tableLines) {
  if (tableLines.length < 3) return tableLines;

  const result = [];

  // Process header
  const headers = extractTableCells(tableLines[1]);
  result.push("|" + headers.join("|") + "|");

  // Add markdown separator
  result.push("|" + headers.map(() => "---").join("|") + "|");

  // Process data rows
  for (let i = 2; i < tableLines.length - 1; i++) {
    if (!isASCIITableBorder(tableLines[i])) {
      const cells = extractTableCells(tableLines[i]);
      result.push("|" + cells.join("|") + "|");
    }
  }

  return result;
}

function extractTableCells(line) {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");
}

// Extract learning outcomes from content
function extractOutcomes(content) {
  const outcomes = [];
  let currentSection = "";
  const lines = content.split("\n");

  for (const line of lines) {
    if (line.startsWith("### ")) {
      currentSection = line.replace("### ", "").trim();
      continue;
    }

    const match = line.match(/(SC[45]-[A-Z]+-\d{2})/);
    if (match) {
      const id = match[1];
      const content = line
        .split(id)[1]
        .trim()
        .replace(/^\*\*|\*\*$/g, "");
      outcomes.push(new LearningOutcome(id, content, currentSection));
    }
  }

  return outcomes;
}

// Generate outcome-specific documents
async function generateOutcomeDocuments(outcomes, outDir) {
  for (const outcome of outcomes) {
    const fileName = `${outcome.id.toLowerCase()}.md`;
    const filePath = path.join(outDir, "outcomes", fileName);

    const content = `# ${outcome.id}: ${outcome.content}

## Section: ${outcome.sectionName}

## Overview
${outcome.content}

## Teaching Strategies

## Resources

## Assessment Strategies

## Notes
`;

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
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
  let content = "";

  try {
    if (ext === ".pdf") {
      // For PDF files, first convert to text
      const tempTextFile = destFile.replace(/\.md$/, ".txt");
      const success = await convertPdfToText(srcFile, tempTextFile);

      if (success) {
        content = await fs.readFile(tempTextFile, "utf-8");
        await fs.unlink(tempTextFile);
      }
    } else {
      // For DOC/DOCX files, use pandoc
      const tempFile = destFile + ".temp";
      const command = `pandoc "${srcFile}" -s -t markdown --wrap=none -o "${tempFile}"`;
      console.log(`Converting ${srcFile} -> ${destFile}`);
      await execAsync(command);
      content = await fs.readFile(tempFile, "utf-8");
      await fs.unlink(tempFile);
    }

    // Clean up the content
    content = cleanFormatting(content);

    // Extract and process outcomes if it's a syllabus file
    if (srcFile.toLowerCase().includes("syllabus")) {
      const outcomes = extractOutcomes(content);
      if (outcomes.length > 0) {
        await generateOutcomeDocuments(outcomes, path.dirname(destFile));

        // Add outcomes summary to the main document
        content += "\n\n## Learning Outcomes Summary\n\n";
        let currentSection = "";
        for (const outcome of outcomes) {
          if (outcome.sectionName !== currentSection) {
            content += `\n### ${outcome.sectionName}\n\n`;
            currentSection = outcome.sectionName;
          }
          content += `- [${outcome.id}](outcomes/${outcome.id.toLowerCase()}.md): ${outcome.content}\n`;
        }
      }
    }

    // Write the final content
    await fs.writeFile(destFile, content, "utf-8");
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
        if (item.name !== "outcomes") {
          // Skip outcomes directory in main index
          filesList = filesList.concat(await getMarkdownFiles(fullPath));
        }
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

  // Add outcomes index if it exists
  const outcomesDir = path.join(outDir, "outcomes");
  try {
    await fs.access(outcomesDir);
    indexContent += "\n## Learning Outcomes\n\n";
    const outcomeFiles = await fs.readdir(outcomesDir);
    for (const file of outcomeFiles) {
      if (path.extname(file) === ".md") {
        const id = path.basename(file, ".md").toUpperCase();
        indexContent += `* [${id}](outcomes/${file})\n`;
      }
    }
  } catch (err) {
    // No outcomes directory exists, skip this section
  }

  const indexPath = path.join(outDir, "index.md");
  await fs.writeFile(indexPath, indexContent, "utf-8");
  console.log(`Index generated at ${indexPath}`);
}

// Process an individual subject directory
async function processSubject(subjectDir) {
  const srcDir = path.join(subjectDir, "src");
  const outDir = path.join(subjectDir, "md-automated");

  try {
    await fs.access(srcDir);
  } catch (err) {
    console.warn(`Skipping ${subjectDir} - no src directory found.`);
    return;
  }

  // Create output directory if it doesn't exist
  await fs.mkdir(outDir, { recursive: true });

  // List all DOCX/PDF files within the src folder recursively
  const files = await listFiles(srcDir, srcDir);
  for (let relPath of files) {
    const srcFile = path.join(srcDir, relPath);
    const destRel = relPath.replace(/\.(docx|pdf|doc)$/i, ".md");
    const destFile = path.join(outDir, destRel);
    await convertFile(srcFile, destFile);
  }

  // Generate an index page for all converted markdown files
  await generateIndex(outDir);
}

// Recursively find directories containing 'src' folder
async function findSubjectDirs(baseDir) {
  let subjectDirs = [];
  const items = await fs.readdir(baseDir, { withFileTypes: true });

  for (let item of items) {
    if (item.isDirectory() && !item.name.startsWith(".")) {
      const fullPath = path.join(baseDir, item.name);

      // Check if this directory has a src folder
      const srcPath = path.join(fullPath, "src");
      try {
        const srcStats = await fs.stat(srcPath);
        if (srcStats.isDirectory()) {
          const srcContents = await fs.readdir(srcPath);
          if (srcContents.length > 0) {
            subjectDirs.push(fullPath);
          }
        }
      } catch (err) {
        // If no src directory here, recurse into subdirectories
        const subDirs = await findSubjectDirs(fullPath);
        subjectDirs = subjectDirs.concat(subDirs);
      }
    }
  }
  return subjectDirs;
}

// Main function to process all subject directories in the base directory
async function main() {
  const baseDir = process.cwd();

  // Recursively find all directories containing a 'src' folder
  const subjectDirs = await findSubjectDirs(baseDir);
  console.log(`Found ${subjectDirs.length} subject directories to process`);

  // Process each subject directory one by one
  for (let subject of subjectDirs) {
    console.log(`Processing subject directory: ${subject}`);
    await processSubject(subject);
  }

  // Generate a top-level index page
  let content = "# NESA Material Subjects Index\n\n";
  for (let subject of subjectDirs) {
    const mdAutoPath = path.join(subject, "md-automated");
    try {
      await fs.access(mdAutoPath);
      const subjectIndexPath = path.join(subject, "md-automated", "index.md");
      content += `* [${path.basename(subject)}](${subjectIndexPath.replace(/\\/g, "/")})\n`;
    } catch (err) {
      // Skip if md-automated directory doesn't exist
    }
  }

  const indexPath = path.join(baseDir, "index.md");
  await fs.writeFile(indexPath, content, "utf-8");
  console.log(`Top-level index generated at ${indexPath}`);
}

// Recursively list files in a directory that match DOC/PDF criteria
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

main().catch((err) => {
  console.error("Error in conversion process:", err);
});
