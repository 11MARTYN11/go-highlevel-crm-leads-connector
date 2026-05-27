import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../config/logger.js';
import config from '../config/index.js';

export interface GHLContact {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  companyName?: string;
  locationId: string;
  tags?: string[];
  customFields?: Record<string, string>;
  [key: string]: any;
}

export interface GHLContactResponse {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  locationId: string;
  dateAdded: string;
  lastActivity: string;
  tags: string[];
}

export interface GHLActivityPayload {
  contactId: string;
  title: string;
  description?: string;
  noteType?: string;
}

/**
 * Go High Level API Client
 * Handles all communication with GHL API
 */
export class GoHighLevelClient {
  private client: AxiosInstance;
  private token: string;
  private apiBaseUrl: string;

  constructor() {
    this.token = config.ghl.apiToken;
    this.apiBaseUrl = config.ghl.apiBaseUrl;

    this.client = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: 10000,
      headers: this.getHeaders(),
    });

    // Add request/response interceptors
    this.client.interceptors.request.use((cfg) => {
      logger.debug({ url: cfg.url, method: cfg.method }, 'GHL API Request');
      return cfg;
    });

    this.client.interceptors.response.use(
      (response) => {
        logger.debug({ status: response.status, url: response.config.url }, 'GHL API Response');
        return response;
      },
      (error: AxiosError) => {
        logger.error(
          { status: error.response?.status, message: error.message, url: error.config?.url },
          'GHL API Error'
        );
        return Promise.reject(error);
      }
    );
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /**
   * Create a new contact in Go High Level
   */
  async createContact(contact: GHLContact): Promise<GHLContactResponse> {
    try {
      const payload = {
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        email: contact.email,
        phone: contact.phone || '',
        companyName: contact.companyName || '',
        locationId: config.ghl.locationId,
        tags: contact.tags || [],
        customFields: contact.customFields || {},
      };

      const response = await this.client.post<GHLContactResponse>('/contacts/', payload);
      logger.info({ contactId: response.data.id, email: contact.email }, 'Contact created');
      return response.data;
    } catch (error) {
      logger.error({ error, contact }, 'Failed to create contact');
      throw error;
    }
  }

  /**
   * Update an existing contact
   */
  async updateContact(contactId: string, updates: Partial<GHLContact>): Promise<GHLContactResponse> {
    try {
      const response = await this.client.put<GHLContactResponse>(`/contacts/${contactId}`, updates);
      logger.info({ contactId }, 'Contact updated');
      return response.data;
    } catch (error) {
      logger.error({ error, contactId }, 'Failed to update contact');
      throw error;
    }
  }

  /**
   * Get contact by email
   */
  async getContactByEmail(email: string): Promise<GHLContactResponse | null> {
    try {
      const response = await this.client.get<{ contacts: GHLContactResponse[] }>(
        `/contacts/search?email=${encodeURIComponent(email)}&locationId=${config.ghl.locationId}`
      );

      if (response.data.contacts && response.data.contacts.length > 0) {
        return response.data.contacts[0];
      }
      return null;
    } catch (error) {
      logger.warn({ email }, 'Contact not found');
      return null;
    }
  }

  /**
   * Add tags to a contact
   */
  async addTagsToContact(contactId: string, tags: string[]): Promise<void> {
    try {
      await this.client.post(`/contacts/${contactId}/tags`, { tags });
      logger.info({ contactId, tags }, 'Tags added to contact');
    } catch (error) {
      logger.error({ error, contactId, tags }, 'Failed to add tags');
      throw error;
    }
  }

  /**
   * Create an activity/note for a contact
   */
  async createActivity(activity: GHLActivityPayload): Promise<void> {
    try {
      await this.client.post(`/contacts/${activity.contactId}/activities`, {
        title: activity.title,
        description: activity.description,
        type: activity.noteType || 'note',
      });
      logger.info({ contactId: activity.contactId }, 'Activity created');
    } catch (error) {
      logger.error({ error, contactId: activity.contactId }, 'Failed to create activity');
      throw error;
    }
  }

  /**
   * Get contact by ID
   */
  async getContact(contactId: string): Promise<GHLContactResponse | null> {
    try {
      const response = await this.client.get<GHLContactResponse>(`/contacts/${contactId}`);
      return response.data;
    } catch (error) {
      logger.warn({ contactId }, 'Contact not found');
      return null;
    }
  }

  /**
   * Health check - verify API connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/contacts/search?limit=1');
      logger.info('GHL API health check passed');
      return !!response.data;
    } catch (error) {
      logger.error({ error }, 'GHL API health check failed');
      return false;
    }
  }

  /**
   * Upsert contact (create if not exists, update if exists)
   */
  async upsertContact(contact: GHLContact): Promise<GHLContactResponse> {
    try {
      // Check if contact exists by email
      const existingContact = await this.getContactByEmail(contact.email);

      if (existingContact) {
        // Update existing contact
        return await this.updateContact(existingContact.id, contact);
      } else {
        // Create new contact
        return await this.createContact(contact);
      }
    } catch (error) {
      logger.error({ error, email: contact.email }, 'Failed to upsert contact');
      throw error;
    }
  }
}

// Export singleton instance
export const ghlClient = new GoHighLevelClient();
