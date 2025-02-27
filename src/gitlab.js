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
            console.log(`🔹 Assignees: ${assignees.join(', ')}`);

            return discussions
                .flatMap(discussion => {
                    // Ignore discussions started by an assignee
                    if (assignees.includes(discussion.notes[0].author.username)) {
                        console.log(`  ❌ Ignoring discussion started by assignee: ${discussion.notes[0].author.username}`);
                        return [];
                    }

                    const unresolvedNotes = discussion.notes.filter(note => note.resolvable && !note.resolved);

                    if (unresolvedNotes.length === 0) return [];

                    // Identify the latest unresolved comment
                    const latestUnresolvedNote = unresolvedNotes.reduce((latest, note) =>
                        new Date(note.created_at) > new Date(latest.created_at) ? note : latest
                    );

                    console.log(`  📌 Unresolved comment by ${latestUnresolvedNote.author.username} at ${latestUnresolvedNote.created_at}`);

                    // Get all replies by assignees in this discussion
                    const assigneeReplies = discussion.notes.filter(note =>
                        assignees.includes(note.author.username) &&
                        new Date(note.created_at) > new Date(latestUnresolvedNote.created_at)
                    );

                    console.log(`  🔎 Assignee replies: ${assigneeReplies.length}`);

                    // If no assignee has replied AFTER the unresolved comment, don't remind the reviewer
                    if (assigneeReplies.length === 0) {
                        console.log(`  ❌ Skipping ${latestUnresolvedNote.author.username} (assignee has NOT replied)`);
                        return [];
                    }

                    return [latestUnresolvedNote.author.username];
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
        const merge_requests = await Promise.all(
            projects
                .filter(project => project.id !== undefined)
                .map(async project => {
                    const mrs = await this.getProjectMergeRequests(project.id);
                    return Promise.all(
                        mrs.map(async mr => {
                            // 🛑 Exclude MRs with detailed_merge_status === "requested_changes"
                            if (mr.detailed_merge_status === "requested_changes") {
                                console.log(`   🚫 Skipping MR #${mr.iid} (Requested changes)`);
                                return null;
                            }

                            const unresolvedUsers = await this.getUnresolvedReviewers(project.id, mr.iid);
                            const pendingReviewers = await this.getPendingApprovals(project.id, mr.iid);
                            const assignedReviewers = await this.getReviewersAndAssignees(project.id, mr.iid);

                            // Fetch approved users (only from allowed reviewers)
                            const { approvedUsers, approvalCount } = await this.getApprovedUsers(project.id, mr.iid, allowedReviewers);

                            // Remove duplicates and filter out approved users
                            let blockers = [...new Set([...unresolvedUsers, ...pendingReviewers, ...assignedReviewers])]
                                .filter(user => !approvedUsers.includes(user));

                            console.log(`🔍 MR #${mr.iid}: ${mr.title}`);
                            console.log(`   Author: ${mr.author.username}`);
                            console.log(`   Reviewers before filtering: ${blockers.length > 0 ? blockers.join(', ') : "None"}`);
                            console.log(`   Allowed reviewers: ${allowedReviewers.length > 0 ? allowedReviewers.join(', ') : "None"}`);
                            console.log(`   Current approvals from allowed reviewers: ${approvalCount}, Required: ${minApprovalsRequired}`);

                            // Apply the minimum approval requirement
                            if (approvalCount >= minApprovalsRequired) {
                                console.log(`   ✅ MR #${mr.iid} already has ${approvalCount} approvals from allowed reviewers (Threshold: ${minApprovalsRequired}). Skipping.`);
                                return null;
                            }

                            // Remove reviewers who left unresolved comments **if no assignee has replied**
                            const unresolvedButNoReply = await this.getUnresolvedReviewers(project.id, mr.iid);
                            blockers = blockers.filter(user => !unresolvedButNoReply.includes(user));

                            // Exclude the author
                            blockers = blockers.filter(user => user !== mr.author.username);

                            console.log(`   ✅ Final Reviewers after checking assignee replies: ${blockers.length > 0 ? blockers.join(', ') : "None (MR will be skipped)"}`);

                            // Ensure that an MR is skipped if no valid reviewers remain
                            if (allowedReviewers.length > 0) {
                                blockers = blockers.filter(user => allowedReviewers.includes(user));

                                if (blockers.length === 0) {
                                    console.log(`   ❌ Skipping MR #${mr.iid} (No allowed reviewers found after filtering)`);
                                    return null;
                                }
                            }

                            mr.blockers = blockers;
                            return mr;
                        })
                    );
                })
        );

        return [].concat(...merge_requests).filter(mr => mr !== null);
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