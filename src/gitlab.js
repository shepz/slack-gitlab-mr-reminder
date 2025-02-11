var request = require('request-promise-native');

class GitLab
{
  constructor(external_url, access_token, group) {
    this.external_url = external_url;
    this.access_token = access_token;
    this.group = group;
  }

  _getProjectMergeRequest(project_id,{page=1}) {
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
      let promises = []
      const resp = await request(options);
      const firstPage = resp.body;
      const totalPages = Number(resp.headers['x-total-pages']);
      for(let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
        promises.push(this._getProjectMergeRequest(project_id,{ page: pageNumber }));
      }

      let merge_requests = firstPage;
      
      if (totalPages > 1) {
        merge_requests = merge_requests.concat(await Promise.all(promises)); 
      } 
      return merge_requests;
    } catch(e) {
      throw e;
    }
  }

  _getProject({ page = 1 }) {
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

      for(let pageNumber = 2; pageNumber <= totalPages; pageNumber++) {
        promises.push(this._getProject({ page: pageNumber }));
      }

      let projects = firstPage;
      if (totalPages > 1) {
        projects = projects.concat(await Promise.all(promises));        
      } 
      
      return projects;
    } catch(e) {      
        throw e;
    }
  }

  async hasUnresolvedDiscussions(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/discussions`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const discussions = await request(options);
      return discussions.some(discussion => 
        discussion.notes.some(note => note.resolvable && !note.resolved)
      );
    } catch (e) {
      console.error(`Error fetching discussions for MR ${mr_iid}:`, e.message);
      return false; // Assume no unresolved discussions on failure
    }
  }

  async isReviewPending(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const approvalData = await request(options);
      return approvalData.approvals_left > 0; // True if approvals are still needed
    } catch (e) {
      console.error(`Error checking approvals for MR ${mr_iid}:`, e.message);
      return false;
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
      return discussions
        .flatMap(discussion => discussion.notes)
        .filter(note => note.resolvable && !note.resolved)
        .map(note => note.author.username);
    } catch (e) {
      console.error(`Error fetching discussions for MR ${mr_iid}:`, e.message);
      return [];
    }
  }

  async getPendingApprovals(project_id, mr_iid) {
    const options = {
      uri: `${this.external_url}/api/v4/projects/${project_id}/merge_requests/${mr_iid}/approvals`,
      headers: { 'PRIVATE-TOKEN': this.access_token },
      json: true
    };
    try {
      const approvalData = await request(options);
      return approvalData.approvers
        .filter(approver => !approver.approved)
        .map(approver => approver.username);
    } catch (e) {
      console.error(`Error checking approvals for MR ${mr_iid}:`, e.message);
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

  async getFilteredMergeRequests() {
    const projects = await this.getProjects();
    const merge_requests = await Promise.all(
      projects
        .filter(project => project.id !== undefined)
        .map(async project => {
          const mrs = await this.getProjectMergeRequests(project.id);
          return Promise.all(
            mrs.map(async mr => {
              const unresolvedUsers = await this.getUnresolvedReviewers(project.id, mr.iid);
              const pendingReviewers = await this.getPendingApprovals(project.id, mr.iid);

              mr.blockers = [...new Set([...unresolvedUsers, ...pendingReviewers])];

              return mr.blockers.length > 0 ? mr : null;
            })
          );
        })
    );

    return [].concat(...merge_requests).filter(mr => mr !== null);
  }
}

module.exports = GitLab;