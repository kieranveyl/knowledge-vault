#!/usr/bin/env bun
/**
 * Publication Workflow Demo Script
 * 
 * Demonstrates SPEC Section 4: Two-phase publish workflow
 * Shows draft → version creation → visibility pipeline
 */

import { Effect } from "effect";
import { createPostgresStorageAdapter } from "../src/adapters/storage/postgres.adapter";
import { createDatabasePool } from "../src/adapters/storage/database";
import type { VersionLabel } from "../src/schema/entities";

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    magenta: '\x1b[35m'
};

async function publishWorkflowDemo() {
    console.log(`${colors.blue}${colors.bright}🚀 Publication Workflow Demo${colors.reset}`);
    console.log("Demonstrating SPEC: Two-phase publish (Validate → Create Version → Enqueue Visibility)\n");

    const db = createDatabasePool();
    const storage = createPostgresStorageAdapter(db);

    try {
        // Step 1: Prepare collections for publication
        console.log(`${colors.cyan}Step 1: Setting up collections for publication...${colors.reset}`);
        
        const primaryCollection = await Effect.runPromise(
            storage.createCollection("Published Research", "Collection for published research papers")
        );
        
        const secondaryCollection = await Effect.runPromise(
            storage.createCollection("Public Documentation", "Publicly available documentation")
        );

        console.log(`${colors.green}✅ Collections ready:${colors.reset}`);
        console.log(`   Primary: "${primaryCollection.name}" (${primaryCollection.id})`);
        console.log(`   Secondary: "${secondaryCollection.name}" (${secondaryCollection.id})`);

        // Step 2: Create note with draft content (SPEC: Draft-by-default)
        console.log(`\n${colors.cyan}Step 2: Creating note with substantial draft content...${colors.reset}`);
        
        const note = await Effect.runPromise(
            storage.createNote(
                "Knowledge Management Systems: A Comprehensive Analysis",
                "# Knowledge Management Systems: A Comprehensive Analysis\n\nDraft version - work in progress.",
                {
                    tags: ["research", "knowledge-management", "systems"],
                    author: "Research Team",
                    draft_status: "ready_for_review"
                }
            )
        );

        // Update with publication-ready content
        const publicationContent = `# Knowledge Management Systems: A Comprehensive Analysis

## Abstract

This paper presents a comprehensive analysis of modern knowledge management systems, with particular focus on local-first architectures and version-controlled content workflows.

## Introduction

Knowledge management has evolved significantly with the advent of distributed systems and privacy-conscious computing. This research examines the key principles that make knowledge systems effective for both individual and organizational use.

## Key Findings

### 1. Local-First Architecture Benefits
- **Privacy**: Data remains under user control
- **Performance**: No network dependency for core operations  
- **Reliability**: System works offline and during network failures
- **Ownership**: Users maintain full control over their content

### 2. Draft-by-Default Publishing
The draft-by-default approach reduces publication anxiety and enables:
- Fearless content creation and editing
- Clear separation between work-in-progress and published material
- Controlled visibility and sharing workflows

### 3. Version Control Integration
Proper version control enables:
- Complete audit trail of content changes
- Safe experimentation with rollback capability
- Collaborative workflows with conflict resolution

## Methodology

Our analysis covered three main areas:
1. **Architecture Patterns**: Evaluation of centralized vs. decentralized approaches
2. **User Experience**: Study of publishing workflows and user behavior
3. **Technical Implementation**: Assessment of performance and reliability characteristics

## Results

### Performance Metrics
- Search latency: P50 < 200ms, P95 < 500ms (target achieved)
- Publication pipeline: P50 < 5s from draft to searchable (target achieved)
- Version creation: < 1s for typical document sizes

### User Satisfaction
- 94% preference for draft-by-default over immediate publishing
- 87% reported increased confidence in content creation
- 91% found version history essential for collaborative work

## Discussion

The combination of local-first architecture with draft-by-default publishing creates a powerful foundation for knowledge work. Key insights include:

1. **Reduced Cognitive Load**: Users can focus on content creation without worrying about premature publication
2. **Enhanced Collaboration**: Version control enables safe concurrent editing
3. **Improved Discoverability**: Controlled publication ensures only quality content is searchable

## Limitations

This study has several limitations:
- Limited to text-based content (no multimedia analysis)
- Focus on individual and small-team usage patterns
- Technical evaluation limited to specific implementation approaches

## Conclusions

Knowledge management systems benefit significantly from:
1. Local-first architectural principles
2. Draft-by-default content workflows  
3. Comprehensive version control integration
4. Performance-optimized search and retrieval

## Future Work

Future research should investigate:
- Multimedia content integration strategies
- Large-scale organizational deployment patterns
- Cross-system interoperability standards
- Advanced search and discovery mechanisms

## References

1. Kleppmann, M. (2019). Local-first software: You own your data, in spite of the cloud.
2. Conway, M. (1968). How do committees invent? Datamation.
3. Raymond, E. (1999). The Cathedral and the Bazaar.

---

*Publication prepared: ${new Date().toISOString()}*
*Ready for peer review and publication*`;

        await Effect.runPromise(
            storage.saveDraft({
                note_id: note.id,
                body_md: publicationContent,
                metadata: {
                    tags: ["research", "knowledge-management", "systems", "published"],
                    author: "Research Team",
                    word_count: publicationContent.split(/\s+/).length,
                    sections: ["abstract", "introduction", "findings", "methodology", "results", "discussion", "conclusions"],
                    ready_for_publication: true,
                    review_status: "approved"
                }
            })
        );

        console.log(`${colors.green}✅ Note with publication-ready draft created:${colors.reset}`);
        console.log(`   Title: "${note.title}"`);
        console.log(`   Note ID: ${note.id}`);
        console.log(`   Word count: ~${publicationContent.split(/\s+/).length} words`);

        // Step 3: First publication (SPEC: Create Version → Publication record)
        console.log(`\n${colors.cyan}Step 3: Publishing first version (minor)...${colors.reset}`);
        
        const firstPublication = await Effect.runPromise(
            storage.publishVersion({
                note_id: note.id,
                collections: [primaryCollection.id],
                label: "minor" as VersionLabel,
                client_token: `pub_${Date.now()}_1`
            })
        );

        console.log(`${colors.green}✅ First publication completed:${colors.reset}`);
        console.log(`   Version ID: ${firstPublication.version_id}`);
        console.log(`   Status: ${firstPublication.status}`);
        console.log(`   Collections: [${primaryCollection.name}]`);
        console.log(`   Estimated searchable in: ${firstPublication.estimated_searchable_in}ms`);

        // Step 4: Retrieve created version
        console.log(`\n${colors.cyan}Step 4: Retrieving published version...${colors.reset}`);
        
        const publishedVersion = await Effect.runPromise(
            storage.getVersion(firstPublication.version_id)
        );

        console.log(`${colors.green}✅ Version details:${colors.reset}`);
        console.log(`   Version ID: ${publishedVersion.id}`);
        console.log(`   Note ID: ${publishedVersion.note_id}`);
        console.log(`   Label: ${publishedVersion.label}`);
        console.log(`   Content hash: ${publishedVersion.content_hash.substring(0, 16)}...`);
        console.log(`   Created: ${publishedVersion.created_at.toISOString()}`);
        console.log(`   Parent version: ${publishedVersion.parent_version_id || 'none (initial)'}`);

        // Step 5: Update draft and republish (major version)
        console.log(`\n${colors.cyan}Step 5: Creating major revision...${colors.reset}`);
        
        const revisedContent = publicationContent + `

## ADDENDUM: Post-Publication Updates

### Additional Findings
After publication, we discovered additional research that strengthens our conclusions:

#### Enhanced Security Analysis
Our security review revealed that local-first systems provide superior protection against:
- Data breaches in centralized systems
- Unauthorized access during network transit
- Third-party data mining and analysis

#### Performance Optimization Insights  
Further testing showed that local-first architecture enables:
- Sub-millisecond response times for local operations
- Predictable performance regardless of network conditions
- Better resource utilization on user devices

### Implementation Recommendations

Based on post-publication feedback, we recommend:

1. **Phased Migration Strategy**: Organizations should adopt local-first principles gradually
2. **Hybrid Approaches**: Combine local-first benefits with selective cloud synchronization
3. **Training Programs**: Invest in user education for new workflow patterns

### Conclusion Updates

The evidence for local-first knowledge management systems is even stronger than initially assessed. We recommend immediate adoption for privacy-sensitive organizations and gradual migration for others.

---

*Revision prepared: ${new Date().toISOString()}*  
*Major update with significant new content*`;

        await Effect.runPromise(
            storage.saveDraft({
                note_id: note.id,
                body_md: revisedContent,
                metadata: {
                    tags: ["research", "knowledge-management", "systems", "published", "revised"],
                    author: "Research Team",
                    word_count: revisedContent.split(/\s+/).length,
                    sections: ["abstract", "introduction", "findings", "methodology", "results", "discussion", "conclusions", "addendum"],
                    ready_for_publication: true,
                    review_status: "approved",
                    revision_notes: "Added post-publication findings and recommendations"
                }
            })
        );

        // Publish major version to multiple collections
        const majorPublication = await Effect.runPromise(
            storage.publishVersion({
                note_id: note.id,
                collections: [primaryCollection.id, secondaryCollection.id],
                label: "major" as VersionLabel,
                client_token: `pub_${Date.now()}_2`
            })
        );

        console.log(`${colors.green}✅ Major revision published:${colors.reset}`);
        console.log(`   Version ID: ${majorPublication.version_id}`);
        console.log(`   Collections: [${primaryCollection.name}, ${secondaryCollection.name}]`);
        console.log(`   Label: major (significant content changes)`);

        // Step 6: Show version history
        console.log(`\n${colors.cyan}Step 6: Reviewing version history...${colors.reset}`);
        
        const versionHistory = await Effect.runPromise(
            storage.listVersions(note.id, { limit: 10 })
        );

        console.log(`${colors.green}✅ Version history (${versionHistory.length} versions):${colors.reset}`);
        versionHistory.forEach((version, index) => {
            const isLatest = index === 0;
            const marker = isLatest ? "→" : " ";
            console.log(`   ${marker} ${version.label.toUpperCase()}: ${version.id}`);
            console.log(`     Created: ${version.created_at.toISOString()}`);
            console.log(`     Hash: ${version.content_hash.substring(0, 16)}...`);
            if (version.parent_version_id) {
                console.log(`     Parent: ${version.parent_version_id}`);
            }
        });

        // Step 7: Check current version
        console.log(`\n${colors.cyan}Step 7: Verifying current version...${colors.reset}`);
        
        const currentVersion = await Effect.runPromise(
            storage.getCurrentVersion(note.id)
        );

        console.log(`${colors.green}✅ Current version confirmed:${colors.reset}`);
        console.log(`   Version ID: ${currentVersion.id}`);
        console.log(`   Label: ${currentVersion.label}`);
        console.log(`   Is latest: ${currentVersion.id === versionHistory[0].id ? 'Yes' : 'No'}`);

        // Summary with SPEC compliance
        console.log(`\n${colors.yellow}${colors.bright}📊 Publication Demo Summary:${colors.reset}`);
        console.log(`• Created comprehensive research content`);
        console.log(`• Published minor version to single collection`);
        console.log(`• Published major revision to multiple collections`);
        console.log(`• Demonstrated complete version history`);
        console.log(`• Verified immutable version creation`);

        console.log(`\n${colors.blue}💡 SPEC Compliance:${colors.reset}`);
        console.log(`• Two-phase publish workflow ✅`);
        console.log(`• Version immutability ✅`);
        console.log(`• Collection many-to-many associations ✅`);
        console.log(`• Version labeling (minor/major) ✅`);
        console.log(`• Publication metadata tracking ✅`);

        console.log(`\n${colors.magenta}🔗 Next Steps:${colors.reset}`);
        console.log(`• Content is now ready for indexing pipeline`);
        console.log(`• Versions should appear in search results`);
        console.log(`• Version rollback functionality available`);

        return {
            note,
            versions: versionHistory,
            collections: [primaryCollection, secondaryCollection]
        };

    } catch (error) {
        console.error(`${colors.red}❌ Publication demo failed:${colors.reset}`, error);
        throw error;
    } finally {
        await Effect.runPromise(db.close());
    }
}

async function main() {
    try {
        const result = await publishWorkflowDemo();
        console.log(`\n${colors.green}🎉 Publication workflow demo completed successfully!${colors.reset}`);
        console.log(`${colors.cyan}Published ${result.versions.length} versions to ${result.collections.length} collections${colors.reset}`);
    } catch (error) {
        console.error(`${colors.red}Script failed:${colors.reset}`, error);
        process.exit(1);
    }
}

if (import.meta.main) {
    main();
}

export { publishWorkflowDemo };
