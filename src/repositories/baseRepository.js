/**
 * Base Repository class to abstract common Mongoose operations.
 */
class BaseRepository {
  /**
   * @param {import('mongoose').Model} model - The Mongoose model to wrap.
   */
  constructor(model) {
    if (!model) {
      throw new Error('Mongoose model must be provided to BaseRepository constructor');
    }
    this.model = model;
  }

  /**
   * Find multiple documents matching a filter.
   * @param {Object} [filter] - Mongoose filter object.
   * @param {Object} [options] - Query options.
   * @param {Object|String} [options.sort] - Sorting criteria.
   * @param {number} [options.limit] - Max number of records to return.
   * @param {number} [options.skip] - Number of records to skip.
   * @param {string|Array|Object} [options.populate] - Fields to populate.
   * @returns {Promise<Array<Object>>}
   */
  async findAll(filter = {}, options = {}) {
    let query = this.model.find(filter);

    if (options.sort) {
      query = query.sort(options.sort);
    }
    if (options.skip !== undefined) {
      query = query.skip(Number(options.skip));
    }
    if (options.limit !== undefined) {
      query = query.limit(Number(options.limit));
    }
    if (options.populate) {
      query = query.populate(options.populate);
    }

    return query.exec();
  }

  /**
   * Find a single document by its _id.
   * @param {string} id - The document identifier.
   * @param {string|Array|Object} [populate] - Fields to populate.
   * @returns {Promise<Object|null>}
   */
  async findById(id, populate = null) {
    let query = this.model.findById(id);
    if (populate) {
      query = query.populate(populate);
    }
    return query.exec();
  }

  /**
   * Find a single document matching a filter.
   * @param {Object} filter - Mongoose filter object.
   * @param {string|Array|Object} [populate] - Fields to populate.
   * @returns {Promise<Object|null>}
   */
  async findOne(filter, populate = null) {
    let query = this.model.findOne(filter);
    if (populate) {
      query = query.populate(populate);
    }
    return query.exec();
  }

  /**
   * Create a new document.
   * @param {Object} data - Document data.
   * @returns {Promise<Object>}
   */
  async create(data) {
    const doc = new this.model(data);
    return doc.save();
  }

  /**
   * Insert multiple documents.
   * @param {Array<Object>} docs - Documents to insert.
   * @param {Object} [options] - insertMany options.
   * @returns {Promise<Array<Object>>}
   */
  async insertMany(docs, options = {}) {
    return this.model.insertMany(docs, options);
  }

  /**
   * Update an existing document by its _id.
   * @param {string} id - The document identifier.
   * @param {Object} data - Update data.
   * @param {Object} [options] - Mongoose findOneAndUpdate options.
   * @returns {Promise<Object|null>}
   */
  async update(id, data, options = { new: true, runValidators: true }) {
    return this.model.findByIdAndUpdate(id, data, options).exec();
  }

  /**
   * Delete a document by its _id.
   * @param {string} id - The document identifier.
   * @returns {Promise<Object|null>}
   */
  async delete(id) {
    return this.model.findByIdAndDelete(id).exec();
  }

  /**
   * Count documents matching a filter.
   * @param {Object} [filter] - Mongoose filter object.
   * @returns {Promise<number>}
   */
  async count(filter = {}) {
    return this.model.countDocuments(filter).exec();
  }

  /**
   * Execute bulk operations on the model.
   * @param {Array<Object>} operations - Bulk operations list.
   * @param {Object} [options] - Bulk write options.
   * @returns {Promise<Object>}
   */
  async bulkWrite(operations, options = {}) {
    return this.model.bulkWrite(operations, options);
  }
}

export default BaseRepository;
