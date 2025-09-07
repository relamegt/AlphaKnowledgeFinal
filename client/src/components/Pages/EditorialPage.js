import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { sheetAPI } from '../../services/api';
import {
  FaArrowLeft,
  FaSpinner,
  FaExclamationTriangle,
  FaBook,
  FaYoutube,
  FaCopy,
  FaCheck,
  FaImage,
} from 'react-icons/fa';
import {
  ChevronRight,
  ChevronDown as ChevronDownLucide,
  Code,
  BookOpen,
  Timer,
  Database,
  ArrowLeft,
  FileText,
  Lightbulb,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';

const EditorialPage = () => {
  const { problemId } = useParams();
  const [problem, setProblem] = useState(null);
  const [editorial, setEditorial] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editorialContent, setEditorialContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('editorial');
  const [expandedSections, setExpandedSections] = useState({});
  const [selectedLanguages, setSelectedLanguages] = useState({});
  const [copiedCode, setCopiedCode] = useState({});
  const [imageLoadErrors, setImageLoadErrors] = useState({});
  const [editorialData, setEditorialData] = useState(null);

  useEffect(() => {
    if (problemId) {
      loadProblemAndEditorial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  const loadProblemAndEditorial = async () => {
    try {
      setLoading(true);
      setError(null);

      const sheetsResponse = await sheetAPI.getAll();
      const sheets = sheetsResponse?.data?.sheets || [];

      let foundProblem = null;
      let foundSheet = null;

      for (const sheet of sheets) {
        for (const section of sheet.sections || []) {
          for (const subsection of section.subsections || []) {
            const prob = (subsection.problems || []).find((p) => p.id === problemId);
            if (prob) {
              foundProblem = prob;
              foundSheet = sheet;
              break;
            }
          }
          if (foundProblem) break;
        }
        if (foundProblem) break;
      }

      if (!foundProblem) {
        throw new Error(`Problem with ID "${problemId}" not found in any sheet`);
      }

      setProblem(foundProblem);

      if (foundProblem.editorialLink && foundProblem.editorialLink.trim()) {
        try {
          let editorialUrl = foundProblem.editorialLink.trim();

          // Convert GitHub blob URL to raw if necessary
          if (editorialUrl.includes('github.com') && !editorialUrl.includes('raw.githubusercontent.com')) {
            if (editorialUrl.includes('/blob/')) {
              editorialUrl = editorialUrl
                .replace('github.com', 'raw.githubusercontent.com')
                .replace('/blob/', '/');
            }
          }

          const response = await fetch(editorialUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch editorial content (${response.status})`);
          }

          const content = await response.text();
          setEditorial(content);
          setEditorialContent(content);

          const parsedData = parseMarkdown(content);
          setEditorialData(parsedData);

          // Initialize collapsed sections
          const initialExpanded = {};
          parsedData.approaches.forEach((approach) => {
            initialExpanded[approach.id] = false;
          });
          setExpandedSections(initialExpanded);

          // Initialize selected language per approach
          const initialLanguages = {};
          parsedData.approaches.forEach((approach) => {
            if (approach.code && approach.code.length > 0) {
              initialLanguages[approach.id] = approach.code.language;
            }
          });
          setSelectedLanguages(initialLanguages);
        } catch (fetchError) {
          const errorContent = `# Editorial Content Error

**Error loading editorial from:** ${foundProblem.editorialLink}

**Error Details:** ${fetchError.message}

The editorial link exists but the content could not be fetched. This could be due to:
- The link being incorrect or inaccessible
- Network connectivity issues
- CORS restrictions
- The file not being publicly accessible

Please check the editorial link and try again.`;

          setEditorial(errorContent);
          setEditorialContent(errorContent);
          setEditorialData(null);
        }
      } else {
        const noEditorialContent = `# No Editorial Available

This problem "${foundProblem.title}" does not have an editorial yet.

Problem ID: ${problemId}
Sheet: ${foundSheet?.name || 'Unknown'}

If you're an admin or mentor, you can add an editorial link from the problem management interface.`;

        setEditorial(noEditorialContent);
        setEditorialContent(noEditorialContent);
        setEditorialData(null);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load editorial');
    } finally {
      setLoading(false);
    }
  };

  // Parse markdown with custom sections, code blocks, and "Special thanks"
 // Parse markdown with custom sections, code blocks, and "Special thanks"
const parseMarkdown = (markdown) => {
  if (!markdown || typeof markdown !== 'string') {
    return { title: '', description: '', approaches: [], videoExplanation: '', specialThanks: null };
  }

  const lines = markdown.split('\n');
  const result = {
    title: '',
    description: '',
    approaches: [],
    videoExplanation: '',
    specialThanks: null,
  };

  let currentApproach = null;
  let currentSection = null;
  let codeBlock = null;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Title
    if (line.startsWith('# ') && !result.title) {
      result.title = line.substring(2).trim();
      continue;
    }

    // Special thanks pattern: Special thanks to [Name](URL) Optional text...
    const specialThanksMatch = line.match(/Special thanks to $$([^$$]+)$$$$([^)]+)$$(.*)/i);
    if (specialThanksMatch) {
      const [, name, url, restOfText] = specialThanksMatch;
      result.specialThanks = {
        name: name?.trim() || '',
        url: url?.trim() || '',
        additionalText: (restOfText || '').trim(),
      };
      continue;
    }

    // Pre-approach description until first "## " heading
    if (!currentApproach && line.trim() && !line.startsWith('#') && !result.specialThanks) {
      result.description += line + '\n';
      continue;
    }

    // Approach heading
    if (line.startsWith('## ')) {
      if (currentApproach) {
        result.approaches.push(currentApproach);
      }

      const name = line.substring(3).trim();
      const id = name.toLowerCase().replace(/\s+/g, '-');

      currentApproach = {
        id,
        name,
        explanation: '',
        code: [],
        complexity: { time: '', space: '' },
      };
      currentSection = 'explanation';
      continue;
    }

    // Known subheadings (ignored because sections tracked explicitly)
    if (
      line.startsWith('### Algorithm Explanation') ||
      line.startsWith('### Implementation') ||
      line.startsWith('### Early Termination with Sentinel') ||
      line.startsWith('### Pre-sorting + Binary Search')
    ) {
      continue;
    }

    if (line.startsWith('### Time Complexity')) {
      currentSection = 'timeComplexity';
      continue;
    }
    if (line.startsWith('### Space Complexity')) {
      currentSection = 'spaceComplexity';
      continue;
    }

    // CODE FENCE FIX: Properly detect and toggle fenced code blocks like ```lang ... ```
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        const language = line.substring(3).trim() || 'text';
        codeBlock = { language, code: '' };
      } else {
        inCodeBlock = false;
        if (currentApproach && codeBlock) {
          currentApproach.code.push(codeBlock);
          codeBlock = null;
        }
      }
      continue;
    }

    // Accumulate content
    if (inCodeBlock && codeBlock) {
      codeBlock.code += line + '\n';
    } else if (currentApproach) {
      if (currentSection === 'explanation') {
        currentApproach.explanation += line + '\n';
      } else if (currentSection === 'timeComplexity') {
        currentApproach.complexity.time += line + '\n';
      } else if (currentSection === 'spaceComplexity') {
        currentApproach.complexity.space += line + '\n';
      }
    }
  }

  if (currentApproach) {
    result.approaches.push(currentApproach);
  }

  return result;
};


  // Parse text for inline <img ... /> tags mixed with paragraphs
  const parseContentWithImages = (content) => {
    if (!content || typeof content !== 'string') return [];

    const lines = content.split('\n');
    const elements = [];
    let currentTextBlock = '';

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();

      // Match basic <img src="..." style="..." />
      const imgMatch = line.match(/<img\s+src=["']([^"']+)["'][^>]*(?:style=["']([^"']+)["'])?[^>]*\/?>/i);

      if (imgMatch) {
        if (currentTextBlock.trim()) {
          elements.push({
            type: 'text',
            content: currentTextBlock,
            key: `text-${elements.length}`,
          });
          currentTextBlock = '';
        }

        const [, src, style] = imgMatch;
        elements.push({
          type: 'image',
          src: src,
          style: style || '',
          key: `image-${elements.length}`,
        });
      } else if (line) {
        currentTextBlock += rawLine + '\n';
      } else {
        currentTextBlock += '\n';
      }
    }

    if (currentTextBlock.trim()) {
      elements.push({
        type: 'text',
        content: currentTextBlock,
        key: `text-${elements.length}`,
      });
    }

    return elements;
  };

  const handleImageError = (imageKey) => {
    setImageLoadErrors((prev) => ({
      ...prev,
      [imageKey]: true,
    }));
  };

  const renderContentElements = (elements) => {
    return elements.map((element) => {
      if (element.type === 'image') {
        const imageKey = `${element.src}-${element.key}`;
        const hasError = !!imageLoadErrors[imageKey];

        if (hasError) {
          return (
            <div
              key={element.key}
              className="my-6 p-4 bg-red-900/30 border border-red-500/30 rounded-xl flex items-center space-x-3"
            >
              <FaImage className="w-5 h-5 text-red-400" />
              <div>
                <p className="text-red-300 font-medium">Failed to load image</p>
                <p className="text-red-400 text-sm break-all">{element.src}</p>
              </div>
            </div>
          );
        }

        // Convert inline style string ("max-width:100%; height:auto") to object
        const inlineStyles = {};
        if (element.style) {
          element.style.split(';').forEach((stylePart) => {
            const [property, value] = stylePart.split(':').map((s) => s.trim());
            if (property && value) {
              const camelProperty = property.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
              inlineStyles[camelProperty] = value;
            }
          });
        }

        return (
          <div key={element.key} className="my-6 flex justify-center">
            <div className="relative inline-block">
              <img
                src={element.src}
                alt="Editorial illustration"
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  borderRadius: '12px',
                  boxShadow:
                    '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
                  ...inlineStyles,
                }}
                onError={() => handleImageError(imageKey)}
                className="border border-slate-600"
              />
            </div>
          </div>
        );
      }

      // Text block: split into paragraphs
      return element.content.split('\n').map((line, lineIndex) =>
        line.trim() ? (
          <p
            key={`${element.key}-${lineIndex}`}
            className="text-slate-300 leading-relaxed text-base sm:text-lg mb-4"
          >
            {line}
          </p>
        ) : null
      );
    });
  };

  const getYouTubeVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
    return match ? match : null;[1]
  };

  const renderSpecialThanks = () => {
    if (!editorialData?.specialThanks) return null;

    return (
      <div className="mt-8 pt-6 border-t border-slate-700/60">
        <p className="text-slate-400 text-base leading-relaxed">
          Special thanks to{' '}
          <a
            href={editorialData.specialThanks.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            {editorialData.specialThanks.name}
          </a>
          {editorialData.specialThanks.additionalText && (
            <span className="text-slate-400"> {editorialData.specialThanks.additionalText}</span>
          )}
        </p>
      </div>
    );
  };

  const toggleSection = (approachId) => {
    setExpandedSections((prev) => ({
      ...prev,
      [approachId]: !prev[approachId],
    }));
  };

  const changeLanguage = (approachId, language) => {
    setSelectedLanguages((prev) => ({
      ...prev,
      [approachId]: language,
    }));
  };

  const copyCode = async (code, approachId, language) => {
    try {
      await navigator.clipboard.writeText(code);
      const key = `${approachId}-${language}`;
      setCopiedCode((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopiedCode((prev) => ({ ...prev, [key]: false }));
      }, 2000);
    } catch {
      // silently ignore
    }
  };

  const formatComplexity = (complexity) => {
    if (!complexity) return '';
    // Convert O$X$ to code-styled O(X)
    return complexity.replace(
      /O\$(.*?)\$/g,
      '<code class="complexity-code">O($1)</code>'
    );
  };

  const getApproachBadgeStyle = (approachName) => {
    const name = (approachName || '').toLowerCase();
    if (name.includes('brute') || name.includes('naive')) {
      return 'bg-red-900/30 text-red-300 border border-red-500/30';
    } else if (name.includes('better') || name.includes('improved')) {
      return 'bg-amber-900/30 text-amber-300 border border-amber-500/30';
    } else if (name.includes('optimal') || name.includes('efficient')) {
      return 'bg-green-900/30 text-green-300 border border-green-500/30';
    }
    return 'bg-blue-900/30 text-blue-300 border border-blue-500/30';
    };

  const handleSaveEditorial = async () => {
    if (!problem) return;
    setSaving(true);
    try {
      setEditorial(editorialContent);
      setIsEditing(false);
      // Persisting to backend would go here if supported
      alert('Editorial saved successfully!');
    } catch (err) {
      alert('Failed to save editorial: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditorialContent(editorial);
    setIsEditing(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
        <div className="text-center space-y-4 sm:space-y-6">
          <div className="relative">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
              <FaSpinner className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-white" />
            </div>
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-white mb-2">
              Loading Editorial
            </h3>
            <p className="text-slate-400 text-sm sm:text-base">
              Please wait while we fetch the solution...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-slate-800/70 backdrop-blur-xl rounded-3xl shadow-xl border border-slate-700/50 p-8 sm:p-12">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-red-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto shadow-lg mb-6">
              <FaExclamationTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Editorial Not Found
            </h2>
            <p className="text-slate-400 mb-4 leading-relaxed">{error}</p>
            <p className="text-sm text-slate-500 mb-8">Problem ID: {problemId}</p>
            <button
              onClick={() => window.close()}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 flex items-center justify-center space-x-2"
            >
              <FaArrowLeft className="w-4 h-4" />
              <span>Close</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-slate-900 backdrop-blur-xl border-b border-slate-700/50 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0">
            {/* Title Section with Back Button */}
            <div className="flex items-center space-x-2 sm:space-x-4 w-full sm:w-auto">
              <button
                onClick={() => window.close()}
                className="w-8 h-8 sm:w-10 sm:h-10 bg-slate-800 hover:bg-slate-700 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0"
                title="Close window"
              >
                <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
              </button>

              <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0">
                  <FaBook className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-xl lg:text-2xl font-bold bg-gradient-to-r from-white via-indigo-300 to-purple-300 bg-clip-text text-transparent truncate">
                    {editorialData?.title || problem?.title || 'Problem Editorial'}
                  </h1>
                  <p className="text-slate-400 text-xs sm:text-sm font-medium hidden sm:block">
                    Comprehensive solution guide with multiple approaches
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center space-x-1 sm:space-x-2 bg-slate-800/60 rounded-xl sm:rounded-2xl p-1 sm:p-1.5 backdrop-blur-sm w-full sm:w-auto">
              <button
                onClick={() => setActiveTab('editorial')}
                className={`px-3 py-2 sm:px-6 sm:py-3 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 flex-1 sm:flex-initial ${
                  activeTab === 'editorial'
                    ? 'bg-slate-700 text-indigo-400 shadow-lg shadow-indigo-500/10'
                    : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-700/50'
                }`}
              >
                <BookOpen className="w-3 h-3 sm:w-4 sm:h-4 inline-block mr-1 sm:mr-2" />
                Editorial
              </button>

              <button
                onClick={() => setActiveTab('video')}
                className={`px-3 py-2 sm:px-6 sm:py-3 rounded-lg sm:rounded-2xl text-xs sm:text-sm font-semibold transition-all duration-300 flex-1 sm:flex-initial ${
                  activeTab === 'video'
                    ? 'bg-slate-700 text-red-400 shadow-lg shadow-red-500/10'
                    : 'text-slate-400 hover:text-red-400 hover:bg-slate-700/50'
                }`}
              >
                <FaYoutube className="w-3 h-3 sm:w-4 sm:h-4 inline-block mr-1 sm:mr-2" />
                Video
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        {activeTab === 'editorial' && (
          <div>
            {!editorial && !loading && (
              <div className="flex items-center justify-center h-64 sm:h-96">
                <div className="text-center space-y-4 sm:space-y-6">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-slate-400 to-slate-500 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
                    <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-semibold text-white mb-2">
                      No Editorial Available
                    </h3>
                    <p className="text-slate-400 max-w-md mx-auto text-sm sm:text-base px-4">
                      The editorial for this problem is not available at the moment.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {editorialData && !loading && !error && (
              <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                {/* Problem Description */}
                {editorialData.description && (
                  <div className="bg-slate-800/70 backdrop-blur-xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 border border-slate-700/50 shadow-xl shadow-slate-900/5">
                    <div className="flex items-center space-x-2 sm:space-x-3 mb-4 sm:mb-6">
                      <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center shrink-0">
                        <Lightbulb className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                      </div>
                      <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">
                        Problem Overview
                      </h2>
                    </div>
                    <div className="prose prose-slate dark:prose-invert max-w-none">
                      {renderContentElements(parseContentWithImages(editorialData.description))}
                    </div>
                  </div>
                )}

                {/* Solution Approaches */}
                <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                  {editorialData.approaches.map((approach, index) => (
                    <div
                      key={approach.id}
                      className="bg-slate-800/70 backdrop-blur-xl rounded-2xl sm:rounded-3xl border border-slate-700/50 shadow-xl shadow-slate-900/5 overflow-hidden"
                    >
                      {/* Approach Header */}
                      <div
                        onClick={() => toggleSection(approach.id)}
                        className="cursor-pointer p-4 sm:p-6 lg:p-8 hover:bg-slate-700/30 transition-all duration-300 border-b border-slate-700/30"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3 sm:space-x-4 lg:space-x-6">
                            <div className="flex items-center space-x-2 sm:space-x-3 lg:space-x-4">
                              {expandedSections[approach.id] ? (
                                <ChevronDownLucide className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 text-indigo-400" />
                              ) : (
                                <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7 text-slate-500" />
                              )}
                              <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shrink-0">
                                <span className="text-white font-bold text-sm sm:text-base lg:text-lg">
                                  {index + 1}
                                </span>
                              </div>
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white mb-2 sm:mb-3">
                                {approach.name}
                              </h3>
                              <span
                                className={`inline-block px-2 sm:px-3 lg:px-4 py-1 sm:py-2 rounded-full text-xs sm:text-sm font-semibold ${getApproachBadgeStyle(
                                  approach.name
                                )}`}
                              >
                                Solution Approach
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Approach Content */}
                      {expandedSections[approach.id] && (
                        <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 lg:space-y-8">
                          {/* Explanation Section */}
                          <div className="bg-slate-800/50 rounded-xl sm:rounded-2xl p-4 sm: p-6 lg:p-8 border border-indigo-500/20">
                            <h4 className="text-base sm:text-lg lg:text-xl font-bold text-white mb-4 sm:mb-6 flex items-center">
                              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 mr-2 sm:mr-3 text-indigo-400" />
                              Algorithm Explanation
                            </h4>
                            <div className="prose prose-slate dark:prose-invert max-w-none">
                              {renderContentElements(parseContentWithImages(approach.explanation))}
                            </div>
                          </div>

                          {/* Implementation Section */}
                          {approach.code && approach.code.length > 0 && (
                            <div className="bg-slate-800/50 rounded-xl sm:rounded-2xl border border-slate-600/30 overflow-hidden">
                              {/* Implementation Header */}
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 sm:p-6 bg-slate-700/30 border-b border-slate-600/30 space-y-3 sm:space-y-0">
                                <h4 className="text-base sm:text-lg lg:text-xl font-bold text-white flex items-center">
                                  <Code className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 mr-2 sm:mr-3 text-purple-400" />
                                  Implementation
                                </h4>

                                {/* Language Tabs */}
                                {approach.code.length > 1 && (
                                  <div className="flex flex-wrap gap-1 bg-slate-800/70 rounded-lg sm:rounded-xl p-1">
                                    {approach.code.map((codeItem) => (
                                      <button
                                        key={codeItem.language}
                                        onClick={() =>
                                          changeLanguage(approach.id, codeItem.language)
                                        }
                                        className={`px-2 sm:px-3 lg:px-4 py-1 sm:py-2 rounded-md sm:rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
                                          selectedLanguages[approach.id] === codeItem.language
                                            ? 'bg-indigo-600 text-white shadow-md'
                                            : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-700/50'
                                        }`}
                                      >
                                        {codeItem.language}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Code Block */}
                              {(approach.code || [])
                                .filter(
                                  (codeItem) =>
                                    codeItem.language === selectedLanguages[approach.id] ||
                                    approach.code.length === 1
                                )
                                .map((codeItem, codeIndex) => (
                                  <div key={codeIndex} className="relative">
                                    <pre className="p-3 sm:p-6 lg:p-8 overflow-x-auto bg-black/80 text-slate-100 text-xs sm:text-sm leading-relaxed font-mono">
                                      <code className={`language-${(codeItem.language || '').toLowerCase()}`}>
                                        {codeItem.code}
                                      </code>
                                    </pre>

                                    {/* Copy Button */}
                                    <button
                                      onClick={() =>
                                        copyCode(codeItem.code, approach.id, codeItem.language)
                                      }
                                      className="absolute top-2 right-2 sm:top-4 sm:right-4 p-2 sm:p-3 bg-white/10 hover:bg-white/20 text-white rounded-lg sm:rounded-xl transition-all duration-200 backdrop-blur-sm border border-white/10"
                                    >
                                      {copiedCode[`${approach.id}-${codeItem.language}`] ? (
                                        <FaCheck className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5 text-green-400" />
                                      ) : (
                                        <FaCopy className="w-3 h-3 sm:w-4 sm:h-4 lg:w-5 lg:h-5" />
                                      )}
                                    </button>
                                  </div>
                                ))}
                            </div>
                          )}

                          {/* Complexity Analysis */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                            {/* Time Complexity */}
                            {approach.complexity.time && (
                              <div className="bg-emerald-900/20 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-emerald-500/20">
                                <h5 className="text-sm sm:text-base lg:text-lg font-bold text-emerald-300 mb-3 sm:mb-4 flex items-center">
                                  <Timer className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3" />
                                  Time Complexity
                                </h5>
                                <div
                                  className="text-emerald-200 text-base sm:text-lg lg:text-xl font-semibold"
                                  dangerouslySetInnerHTML={{
                                    __html: formatComplexity(approach.complexity.time),
                                  }}
                                />
                              </div>
                            )}

                            {/* Space Complexity */}
                            {approach.complexity.space && (
                              <div className="bg-violet-900/20 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-violet-500/20">
                                <h5 className="text-sm sm:text-base lg:text-lg font-bold text-violet-300 mb-3 sm:mb-4 flex items-center">
                                  <Database className="w-4 h-4 sm:w-5 sm:h-5 mr-2 sm:mr-3" />
                                  Space Complexity
                                </h5>
                                <div
                                  className="text-violet-200 text-base sm:text-lg lg:text-xl font-semibold"
                                  dangerouslySetInnerHTML={{
                                    __html: formatComplexity(approach.complexity.space),
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Special Thanks Section */}
                {renderSpecialThanks()}
              </div>
            )}

            {/* Fallback: simple markdown */}
            {editorial && !editorialData && !loading && !error && (
              <div className="bg-slate-800/70 backdrop-blur-xl rounded-2xl sm:rounded-3xl p-6 border border-slate-700/50 shadow-xl shadow-slate-900/5">
                {isEditing ? (
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-white mb-4">Edit Editorial Content</h2>
                    <textarea
                      value={editorialContent}
                      onChange={(e) => setEditorialContent(e.target.value)}
                      className="w-full h-96 p-4 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-700 text-white font-mono text-sm resize-vertical"
                      placeholder="Enter editorial content in Markdown format..."
                    />
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={handleCancelEdit}
                        className="px-4 py-2 text-slate-400 border border-slate-600 rounded-md hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEditorial}
                        disabled={saving}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-lg dark:prose-invert max-w-none prose-slate">
                    <ReactMarkdown
                      components={{
                        code({ inline, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter style={tomorrow} language={match} PreTag="div" {...props}>[1]
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {editorial}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Video Tab */}
        {activeTab === 'video' && (
          <div className="bg-slate-800/70 backdrop-blur-xl rounded-2xl sm:rounded-3xl border border-slate-700/50 shadow-xl shadow-slate-900/5">
            {problem?.youtubeLink && getYouTubeVideoId(problem.youtubeLink) ? (
              <div className="p-4 sm:p-6 lg:p-8">
                <div className="flex items-center space-x-2 sm:space-x-3 mb-4 sm:mb-6">
                  <div className="text-red-500">
                    <FaYoutube className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12" />
                  </div>
                  <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">Video Tutorial</h2>
                </div>

                {/* Embedded YouTube Video */}
                <div
                  className="video-responsive relative w-full rounded-xl sm:rounded-2xl overflow-hidden shadow-lg"
                  style={{ paddingBottom: '56.25%', height: 0 }}
                >
                  <iframe
                    src={`https://www.youtube.com/embed/${getYouTubeVideoId(problem.youtubeLink)}?rel=0&modestbranding=1`}
                    title={`${problem?.title || 'Problem'} - Video Tutorial`}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="absolute top-0 left-0 w-full h-full"
                  />
                </div>

                <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-blue-900/20 rounded-xl sm:rounded-2xl border border-blue-500/20">
                  <p className="text-slate-400 text-center text-sm sm:text-base">
                    Watch the comprehensive video explanation with step-by-step walkthrough of the solution approaches.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-6 sm: p-8 lg:p-12 text-center space-y-6 sm:space-y-8">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-slate-400 to-slate-500 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto shadow-xl">
                  <FaYoutube className="w-8 h-8 sm:w-10 sm:h-10 text-white opacity-60" />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3 sm:mb-4">
                    Video Not Available
                  </h2>
                  <p className="text-slate-400 max-w-2xl mx-auto text-base sm:text-lg px-4">
                    A video explanation for this problem is not currently available.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .complexity-code {
          background: rgba(99, 102, 241, 0.2);
          padding: 6px 12px;
          border-radius: 10px;
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
          font-size: 1.1em;
          font-weight: 600;
          border: 1px solid rgba(165, 180, 252, 0.3);
          color: #a5b4fc;
          display: inline-block;
          margin: 2px;
        }

        /* Video responsive adjustments */
        @media (max-width: 767px) {
          .video-responsive {
            padding-bottom: 56.25% !important;
            height: 0 !important;
          }
        }

        @media (min-width: 768px) {
          .video-responsive {
            max-height: 70vh !important;
            height: 70vh !important;
            padding-bottom: 0 !important;
          }

          .video-responsive iframe {
            height: 100% !important;
          }
        }

        @media (min-width: 1024px) {
          .video-responsive {
            max-height: 65vh !important;
            height: 65vh !important;
          }
        }

        @media (min-width: 1440px) {
          .video-responsive {
            max-height: 60vh !important;
            height: 60vh !important;
          }
        }

        /* Dark theme prose overrides */
        .prose {
          color: #cbd5e1;
        }
        .prose h1,
        .prose h2,
        .prose h3,
        .prose h4,
        .prose h5,
        .prose h6 {
          color: #f1f5f9;
        }
        .prose a {
          color: #60a5fa;
        }
        .prose a:hover {
          color: #3b82f6;
        }
        .prose code {
          background-color: rgba(51, 65, 85, 0.8);
          color: #e2e8f0;
          padding: 0.2em 0.4em;
          border-radius: 0.375rem;
        }
        .prose pre {
          background-color: rgba(15, 23, 42, 0.9);
          color: #e2e8f0;
        }
        .prose blockquote {
          border-left-color: #475569;
          color: #94a3b8;
        }
        .prose strong {
          color: #f1f5f9;
        }
        .prose em {
          color: #cbd5e1;
        }
      `}</style>
    </div>
  );
};

export default EditorialPage;
