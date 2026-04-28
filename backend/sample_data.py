"""
QA Parameters and Agent Group definitions.
Tickets are now loaded dynamically from uploaded Excel files.
"""

QA_PARAMETERS = [
    {
        "id": 1,
        "name": "Closure Confirmation documented",
        "group": "A",
        "group_name": "Closure & Resolution",
        "logic": "It checks whether the incident's Work Notes and Resolution Notes both contains the closure-confirmation phrase or not when the incident is Resolved."
    },
    {
        "id": 2,
        "name": "LMI session closure or resolution confirmation is taken from user",
        "group": "A",
        "group_name": "Closure & Resolution",
        "logic": "It checks whether Work Notes contain an LMI (LogMeIn) session along with user-provided closure or resolution confirmation."
    },
    {
        "id": 4,
        "name": "Elaborative Closure notes updated",
        "group": "A",
        "group_name": "Closure & Resolution",
        "logic": "It checks that Resolution Notes contain sufficiently detailed closure documentation (minimum three meaningful lines) when the incident is Resolved or Closed."
    },
    {
        "id": 3,
        "name": "Validate ZTP cases",
        "group": "B",
        "group_name": "Compliance & Process",
        "logic": "It scans the Work Notes for BitLocker keys, BIOS passwords, or similar sensitive ZTP-related information and flag the case if any such data is present."
    },
    {
        "id": 5,
        "name": "Relevant Input in work notes (CAP)",
        "group": "B",
        "group_name": "Compliance & Process",
        "logic": "It checks Work Notes and Resolution Notes for documented Cause, Action, and Prevention (CAP) details in the incident."
    },
    {
        "id": 6,
        "name": "Validate usage of Remote Actions",
        "group": "B",
        "group_name": "Compliance & Process",
        "logic": "It checks in Work Notes whether a remote action was performed or not while resolving the incident."
    },
    {
        "id": 7,
        "name": "Out of scope INC is timely cancelled",
        "group": "C",
        "group_name": "Timeliness & SLA",
        "logic": "For incidents listed in the Reassignment_metric sheet, verify that Work Notes document timely cancellation with appropriate explanation."
    },
    {
        "id": 8,
        "name": "Regular updates on the incident (24-48 hrs)",
        "group": "C",
        "group_name": "Timeliness & SLA",
        "logic": "It checks whether the Work Notes have been updated at intervals no greater than 48 hours for incidents not in Pending state."
    },
    {
        "id": 10,
        "name": "First user connect within 30 minutes",
        "group": "C",
        "group_name": "Timeliness & SLA",
        "logic": "Check that the first non-system Work Note was added within 30 minutes of the ticket's Opened timestamp."
    },
    {
        "id": 11,
        "name": "No follow-up after user's business hours",
        "group": "C",
        "group_name": "Timeliness & SLA",
        "logic": "Verify that all Work Notes timestamps fall within the user's local business hours (8 AM - 6 PM) unless the incident was resolved quickly or has no updates."
    },
    {
        "id": 9,
        "name": "Category/Subcategory selected as per issue",
        "group": "D",
        "group_name": "Categorization & Hold",
        "logic": "Verify that the incident's Category and Subcategory align with predefined keywords matching the Short Description when the category is Workplace or Software."
    },
    {
        "id": 12,
        "name": "INC should be on Hold with valid reasons",
        "group": "D",
        "group_name": "Categorization & Hold",
        "logic": "For incidents in Pending state, ensure Work Notes document a valid reason when the ticket is placed on hold."
    }
]

AGENT_GROUPS = {
    "A": {"name": "Closure & Resolution", "params": [1, 2, 4], "color": "#3B82F6"},
    "B": {"name": "Compliance & Process", "params": [3, 5, 6], "color": "#8B5CF6"},
    "C": {"name": "Timeliness & SLA", "params": [7, 8, 10, 11], "color": "#F59E0B"},
    "D": {"name": "Categorization & Hold", "params": [9, 12], "color": "#10B981"},
}