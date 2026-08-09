'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { indexDirectory, indexFiles } = require('./indexer');

class KnowledgeService {
  constructor(options = {}) {
    this.directories = options.directories || [];
    this.files = options.files || [];
    this.index = new Map();
    this.logger = options.logger || null;
  }

  async buildIndex() {
    this.index = new Map();

    for (const dir of this.directories) {
      if (fs.existsSync(dir)) {
        indexDirectory(dir, this.index);
      }
    }

    for (const entry of indexFiles(this.files).values()) {
      this.index.set(entry.id, entry);
    }

    if (this.logger) {
      this.logger.info('knowledge_index_rebuilt', null, {
        entryCount: this.index.size,
        directories: this.directories,
        files: this.files,
      });
    }

    return { entryCount: this.index.size };
  }

  async search(query) {
    const topic = query.topic || query.query || '';
    const tags = query.tags || [];
    const limit = query.limit || 10;

    if (this.index.size === 0) {
      await this.buildIndex();
    }

    const terms = topic.toLowerCase().split(/\s+/).filter(Boolean);
    const results = [];

    for (const entry of this.index.values()) {
      const text = `${entry.title} ${entry.content} ${entry.type}`.toLowerCase();
      const tagMatch = tags.length === 0 || tags.some(tag => text.includes(tag.toLowerCase()));
      const termMatch = terms.length === 0 || terms.some(term => text.includes(term));

      if (tagMatch && termMatch) {
        results.push(entry);
      }
    }

    return {
      entries: results.slice(0, limit),
      total: results.length,
    };
  }

  async getDocument(id) {
    if (this.index.size === 0) {
      await this.buildIndex();
    }
    return this.index.get(id) || null;
  }

  async list() {
    if (this.index.size === 0) {
      await this.buildIndex();
    }
    return Array.from(this.index.values()).map(entry => ({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      source: entry.source,
      updatedAt: entry.updatedAt,
    }));
  }
}

function createKnowledgeService(options = {}) {
  return new KnowledgeService(options);
}

module.exports = {
  KnowledgeService,
  createKnowledgeService,
};
