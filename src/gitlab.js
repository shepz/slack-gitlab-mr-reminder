var request = require('request-promise-native');

class GitLab {
    constructor(external_url, access_token, group) {
        this.external_url = external_url;
        this.access_token = access_token;
        this.group = group;
    }

    _getProjectMergeRequest(project_id, {page = 1}) {
        const options = {
            uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests?state=opened&page=${page}`,
            headers: {
                'PRIVATE-TOKEN': this.access_token
            },
            json: true
        };
        return request(options);
    }

    async getProjectMergeRequests(project_id) {
        const options = {
            uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests?state=opened`,
            headers: {
                'PRIVATE-TOKEN': this.access_token,
            },
            json: true,
            resolveWithFullResponse: true,
        };
    
        try {
            let promises = [];
            const resp = await request(options);
            const firstPage = resp.body;
            const totalPages = Number(resp.headers['x-total-pages']);
    
            for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
                promises.push(this._getProjectMergeRequest(project_id, {page: pageNumber}));
            }
    
            let merge_requests = firstPage;
    
            if (totalPages > 1) {
                const additionalPages = await Promise.all(promises);
                // Flatten the array so each element is a MR object
                merge_requests = merge_requests.concat(...additionalPages);
            }
            return merge_requests;
        } catch (e) {
            throw e;
        }
    }    

    _getProject({page = 1}) {
        const options = {
            uri: `${this.external_url}/api/v4/groups/${this.group}/projects?page=${page}`,
            headers: {
                'PRIVATE-TOKEN': this.access_token
            },
            json: true
        };
        return request(options);
    }

    async getProjects() {
        const options = {
            uri: `${this.external_url}/api/v4/groups/${this.group}/projects`,
            headers: {
                'PRIVATE-TOKEN': this.access_token
            },
            json: true,
            resolveWithFullResponse: true,
        };
        try {
            let promises = []
            const resp = await request(options);
            const firstPage = resp.body;
            const totalPages = Number(resp.headers['x-total-pages']);
            // console.log(resp.headers);

            for (let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
                promises.push(this._getProject({page: pageNumber}));
            }

            let projects = firstPage;
            if (totalPages > 1) {
                projects = projects.concat(await Promise.all(promises));
            }

            return projects;
        } catch (e) {
            throw e;
        }
    }

    async getUnresolvedReviewers(project_id, mr_iid) {
        const options = {
            uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/discussions`,
            headers: { 'PRIVATE-TOKEN': this.access_token },
            json: true
        };

        try {
            const discussions = await request(options);
            const assignees = await this.getReviewersAndAssignees(project_id, mr_iid);

            console.log(`🔍 Checking unresolved discussions for MR ${mr_iid}`);
            console.log(`🔹 Assignees: ${assignees.length > 0 ? assignees.join(', ') : "None"}`);

            return discussions
                .flatMap(discussion => {
                    // Ignore discussions started by an assignee
                    if (assignees.includes(discussion.notes[0].author.username)) {
                        console.log(`  ❌ Ignoring discussion started by assignee: ${discussion.notes[0].author.username}`);
                        return [];
                    }

                    // Get all resolvable notes in this discussion
                    const resolvableNotes = discussion.notes.filter(note => note.resolvable);
                    
                    // If there are no resolvable notes or all are resolved, skip this discussion
                    if (resolvableNotes.length === 0 || resolvableNotes.every(note => note.resolved)) {
                        console.log(`  ✅ Discussion is resolved or has no resolvable notes`);
                        return [];
                    }

                    // Get all unresolved notes
                    const unresolvedNotes = resolvableNotes.filter(note => !note.resolved);
                    
                    // If all notes are resolved, skip this discussion
                    if (unresolvedNotes.length === 0) {
                        console.log(`  ✅ All notes are resolved in this discussion`);
                        return [];
                    }

                    // Sort all notes by creation date (newest first)
                    const sortedNotes = [...discussion.notes].sort((a, b) => 
                        new Date(b.created_at) - new Date(a.created_at)
                    );
                    
                    // Check if the latest note is from an assignee
                    const latestNote = sortedNotes[0];
                    if (assignees.includes(latestNote.author.username)) {
                        console.log(`  ✅ Latest comment is from assignee: ${latestNote.author.username}`);
                        return [];
                    }
                    
                    // If we reach here, discussion is unresolved and last comment is not from assignee
                    // Return the author of the first note in the discussion (the reviewer who started it)
                    const reviewer = discussion.notes[0].author.username;
                    console.log(`  ⚠️ Unresolved discussion started by ${reviewer} and last comment is not from assignee`);
                    return [reviewer];
                });
        } catch (error) {
            console.error(`Error fetching unresolved reviewers for MR ${mr_iid}:`, error);
            return [];
        }
    }


    async getApprovedUsers(project_id, mr_iid, allowedReviewers) {
        const options = {
            uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
            headers: {'PRIVATE-TOKEN': this.access_token},
            json: true
        };
        try {
            const approvalData = await request(options);

            // ✅ List of users who have approved
            let approvedUsers = approvalData.approved_by.map(approver => approver.user.username);

            // ✅ If allowedReviewers is set, only count approvals from this list
            if (allowedReviewers.length > 0) {
                approvedUsers = approvedUsers.filter(user => allowedReviewers.includes(user));
            }

            // ✅ Number of valid approvals (from allowed reviewers only)
            const approvalCount = approvedUsers.length;

            return {approvedUsers, approvalCount};
        } catch (e) {
            console.error(`Error checking approved users for MR ${mr_iid}:`, e.message);
            return {approvedUsers: [], approvalCount: 0};
        }
    }


    async getPendingApprovals(project_id, mr_iid) {
        const options = {
            uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
            headers: {'PRIVATE-TOKEN': this.access_token},
            json: true
        };
        try {
            const approvalData = await request(options);

            // ✅ Filter only users who have NOT approved
            const pendingApprovers = approvalData.approvers
                .filter(approver => !approver.approved)
                .map(approver => approver.username);

            return pendingApprovers;
        } catch (e) {
            console.error(`Error checking approvals for MR ${mr_iid}:`, e.message);
            return [];
        }
    }

    async getReviewersAndAssignees(project_id, mr_iid) {
        const options = {
            uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}`,
            headers: {'PRIVATE-TOKEN': this.access_token},
            json: true
        };

        try {
            const mr = await request(options);

            const reviewers = mr.reviewers ? mr.reviewers.map(r => r.username) : [];
            const assignees = mr.assignees ? mr.assignees.map(a => a.username) : [];

            return [...new Set([...reviewers, ...assignees])]; // Remove duplicates
        } catch (e) {
            console.error(`Error fetching reviewers for MR ${mr_iid}:`, e.message);
            return [];
        }
    }

    async getGroupMergeRequests() {
        const projects = await this.getProjects();
        const merge_requests = await Promise.all(
            projects
                .filter((project) => project.id !== undefined)
                .map((project) => this.getProjectMergeRequests(project.id))
        );
        return [].concat(...merge_requests);
    }

    async getFilteredMergeRequests(allowedReviewers, minApprovalsRequired = 0) {
        if (!Array.isArray(allowedReviewers)) {
            allowedReviewers = [];
        }

        console.log(`🔍 Applying allowed reviewers: ${allowedReviewers.length > 0 ? allowedReviewers.join(', ') : "None (all reviewers allowed)"}`);
        console.log(`🔍 Minimum approvals required: ${minApprovalsRequired}`);

        const projects = await this.getProjects();
        const mergeRequestsPromises = projects
            .filter(project => project.id !== undefined)
            .map(async project => {
                const mrs = await this.getProjectMergeRequests(project.id);
                return Promise.all(
                    mrs.map(async mr => {
                        console.log(`🔍 Processing MR #${mr.iid}: ${mr.title}`);
                        console.log(`   Author: ${mr.author.username}`);

                        // 1. Exclude MRs with detailed_merge_status === "requested_changes"
                        if (mr.detailed_merge_status === "requested_changes") {
                            console.log(`   🚫 Skipping MR #${mr.iid} (Requested changes)`);
                            return null;
                        }

                        // 2. Get assignees for this MR
                        const assignees = await this.getReviewersAndAssignees(project.id, mr.iid);
                        console.log(`   🔹 Assignees: ${assignees.length > 0 ? assignees.join(', ') : "None"}`);

                        // 3. Get approval information
                        const { approvedUsers, approvalCount } = await this.getApprovedUsers(project.id, mr.iid, allowedReviewers);
                        console.log(`   ✅ Approved by: ${approvedUsers.length > 0 ? approvedUsers.join(', ') : "None"}`);
                        console.log(`   ✅ Approval count from allowed reviewers: ${approvalCount}, Required: ${minApprovalsRequired}`);

                        // 4. Skip if we have enough approvals from allowed reviewers
                        if (approvalCount >= minApprovalsRequired && minApprovalsRequired > 0) {
                            console.log(`   ✅ MR #${mr.iid} has enough approvals (${approvalCount}/${minApprovalsRequired}). Skipping.`);
                            return null;
                        }

                        // 5. Get list of unresolved reviewers (discussions where last comment is not from assignee)
                        // The getUnresolvedReviewers method already filters out discussions where:
                        // - The discussion is started by an assignee
                        // - The discussion is resolved
                        // - The last comment is from an assignee
                        const unresolvedReviewers = await this.getUnresolvedReviewers(project.id, mr.iid);
                        console.log(`   📝 Unresolved reviewers: ${unresolvedReviewers.length > 0 ? unresolvedReviewers.join(', ') : "None"}`);

                        // 6. Get pending reviewers (those who haven't approved yet)
                        const pendingReviewers = await this.getPendingApprovals(project.id, mr.iid);
                        console.log(`   🔄 Pending reviewers: ${pendingReviewers.length > 0 ? pendingReviewers.join(', ') : "None"}`);

                        // 7. Combine potential blockers (unique set of unresolved reviewers and pending reviewers)
                        let blockers = [...new Set([...unresolvedReviewers, ...pendingReviewers])];
                        console.log(`   ⚠️ Initial blockers: ${blockers.length > 0 ? blockers.join(', ') : "None"}`);

                        // 8. Exclude the MR author from the blockers list
                        blockers = blockers.filter(user => user !== mr.author.username);

                        // 9. Exclude assignees from the blockers list (their comments shouldn't block)
                        blockers = blockers.filter(user => !assignees.includes(user));
                        console.log(`   🔍 After excluding author and assignees: ${blockers.length > 0 ? blockers.join(', ') : "None"}`);

                        // 10. Filter by allowed reviewers if specified
                        if (allowedReviewers.length > 0) {
                            blockers = blockers.filter(user => allowedReviewers.includes(user));
                            console.log(`   🔍 After filtering to allowed reviewers: ${blockers.length > 0 ? blockers.join(', ') : "None"}`);
                            
                            // 11. Skip if no allowed reviewers remain as blockers
                            if (blockers.length === 0) {
                                console.log(`   ❌ Skipping MR #${mr.iid} (No allowed reviewers found after filtering)`);
                                return null;
                            }
                        }

                        // 12. Remove users who have already approved from blockers
                        blockers = blockers.filter(user => !approvedUsers.includes(user));
                        console.log(`   ✅ Final blockers: ${blockers.length > 0 ? blockers.join(', ') : "None"}`);

                        // 13. Skip if no blockers remain
                        if (blockers.length === 0) {
                            console.log(`   ✅ Skipping MR #${mr.iid} (No blockers remain)`);
                            return null;
                        }

                        // Add the blockers to the MR object
                        mr.blockers = blockers;
                        return mr;
                    })
                );
            });

        const mergeRequestsLists = await Promise.all(mergeRequestsPromises);
        return [].concat(...mergeRequestsLists).filter(mr => mr !== null);
    }

    async getGroupName() {
        const options = {
            uri: `${this.external_url}/api/v4/groups/${this.group}`,
            headers: { 'PRIVATE-TOKEN': this.access_token },
            json: true
        };

        try {
            const group = await request(options);
            return group.name;
        } catch (e) {
            console.error(`Error fetching group name for group ID ${this.group}:`, e.message);
            return null;
        }
    }
}

module.exports = GitLab;